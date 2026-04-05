# Wave 3 Sumsub Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Wave 3 onboarding's local `CDD/EDD` runtime flow with a Sumsub-workflow-driven onboarding flow that stays pending until provider workflow termination, goes directly to `APPROVED` after `level1`-only success, and enters `FINAL_APPROVAL` only after `level2` success.

**Architecture:** Keep onboarding business ownership inside `OnboardingService`, add an onboarding-scoped `SumsubClient`, a real webhook controller, and a simulation controller that both feed the same event handler. Collapse canonical onboarding status to `NONE / PENDING_VERIFICATION / FINAL_APPROVAL / APPROVED / REJECTED / WITHDRAWN`, and expose provider progress through a verification projection instead of local `CDD/EDD` states.

**Tech Stack:** NestJS 11, Prisma 5, Jest, React 19 + Vite, Swagger, Sumsub User Verification webhooks

---

## File Map

### Existing files to modify

- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customer-status.util.ts`
  - Canonical onboarding status union, next-step actions, blocked reasons, helper predicates.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customer-status.util.spec.ts`
  - Unit coverage for the new status model and next-step resolution.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.controller.ts`
  - Legacy admin status filter compatibility for `PENDING_CDD / REVIEW_CDD / PENDING_EDD / REVIEW_EDD`.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.controller.spec.ts`
  - Filter regression coverage.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
  - Customer onboarding projection fields and new canonical status comment.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/main.ts`
  - Enable `rawBody` for Sumsub webhook signature validation.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.module.ts`
  - Wire new Sumsub client and controllers into the onboarding module.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-customer.controller.ts`
  - Add provider-first onboarding start endpoint and mark legacy session endpoints as legacy-only.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/dto/onboarding.dto.ts`
  - Add DTOs for start verification and simulated Sumsub events.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
  - Start Sumsub verification, expose verification projection, and process Sumsub events.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`
  - Main behavior tests for webhook-driven transitions and onboarding projection.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts`
  - Reuse and, if needed, minimally extend final approval handoff after `level2` success.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`
  - Coverage for idempotent final approval creation if any public helper changes.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web/src/utils/customerOnboarding.ts`
  - Frontend canonical status helpers.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web/src/pages/Verification.tsx`
  - Replace old `CDD/EDD/session` UX with provider-first verification UX and simulation flow.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
  - Roadmap alignment.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/customer-onboarding-module.md`
  - Module truth update.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/onboarding-canonical-workflow.md`
  - Canonical workflow rewrite.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/onboarding-flow-constraints.md`
  - Constraint updates for webhook-driven onboarding.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - Audit and trace contract update.

### New files to create

- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/migrations/20260405123000_wave3_sumsub_onboarding_projection/migration.sql`
  - Schema migration for onboarding projection fields and state remapping.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.types.ts`
  - Shared onboarding-only Sumsub payload and projection types.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`
  - Thin HTTP client for onboarding-related Sumsub calls.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts`
  - Unit tests for signing and request shaping.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts`
  - Real webhook intake endpoint.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts`
  - Signature and dispatch coverage.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts`
  - Simulation endpoint that emits synthetic Sumsub webhook payloads into the same handler.
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts`
  - Coverage that simulation reuses the real event-processing path.

## Working Assumptions

- Use onboarding-only Sumsub integration now; periodic review and transaction flows stay unchanged.
- Real onboarding completion is driven by `applicantWorkflowCompleted` and `applicantWorkflowFailed`.
- `applicantReviewed + GREEN` closes a level, not the whole onboarding flow.
- `sumsubExperiencedLevel2` is the stable local flag that determines whether workflow completion should land in `FINAL_APPROVAL`.
- The frontend keeps using `/onboarding/me` and `/onboarding/next-step`, but those payloads gain a `verification` projection and stop using old `CDD/EDD` canonical semantics.
- The new customer-facing start endpoint is `POST /onboarding/verification/start` and is idempotent.
- The new real webhook endpoint is `POST /onboarding/sumsub/webhook`.
- The new simulation endpoint is `POST /onboarding/sumsub/simulate` and accepts authenticated customer tokens for self-only simulation in development mode.

## Task 1: Collapse Canonical Onboarding Status Helpers

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customer-status.util.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customer-status.util.spec.ts`

- [ ] **Step 1: Write failing unit tests for the new canonical status model**

```ts
it('returns CONTINUE_VERIFICATION while onboarding is pending and provider says customer can continue', () => {
  expect(
    getCustomerNextStepActionTypes({
      onboardingStatus: 'PENDING_VERIFICATION',
      verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
      verificationCustomerActionRequired: true,
      verificationCanContinue: true,
    }),
  ).toEqual(['CONTINUE_VERIFICATION']);
});

it('returns WAIT_VERIFICATION while Sumsub is still processing without customer action', () => {
  expect(
    getCustomerNextStepActionTypes({
      onboardingStatus: 'PENDING_VERIFICATION',
      verificationSubstatus: 'UNDER_REVIEW',
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
    }),
  ).toEqual(['WAIT_VERIFICATION']);
});

it('keeps FINAL_APPROVAL and APPROVED behavior unchanged', () => {
  expect(
    getCustomerNextStepActionTypes({
      onboardingStatus: 'FINAL_APPROVAL',
    }),
  ).toEqual(['WAIT_FINAL_APPROVAL']);

  expect(
    getCustomerNextStepActionTypes({
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
    }),
  ).toEqual(['NONE']);
});
```

- [ ] **Step 2: Run the status helper test file and confirm the new cases fail**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/customer-status.util.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/customer-status.util.spec.ts
```

- [ ] **Step 3: Replace old `CDD/EDD` runtime states with provider-first canonical helpers**

```ts
export type CustomerOnboardingStatus =
  | 'NONE'
  | 'PENDING_VERIFICATION'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CustomerNextStepActionType =
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT_VERIFICATION'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';

export interface CustomerStatusSource {
  onboardingStatus?: string | null;
  operatingStatus?: string | null;
  restrictionStatus?: string | null;
  verificationSubstatus?: string | null;
  verificationCustomerActionRequired?: boolean | null;
  verificationCanContinue?: boolean | null;
  eddRequired?: boolean | null;
  cddDocumentExpiresAt?: Date | string | null;
}

export function getCustomerNextStepActionTypes(
  source: CustomerStatusSource,
): CustomerNextStepActionType[] {
  const canonical = resolveCustomerCanonicalState(source);

  switch (canonical.onboardingStatus) {
    case 'NONE':
      return ['START_VERIFICATION'];
    case 'PENDING_VERIFICATION':
      return source.verificationCanContinue ? ['CONTINUE_VERIFICATION'] : ['WAIT_VERIFICATION'];
    case 'FINAL_APPROVAL':
      return ['WAIT_FINAL_APPROVAL'];
    case 'APPROVED':
      return ['NONE'];
    case 'REJECTED':
    case 'WITHDRAWN':
      return ['REINITIATE_VERIFICATION'];
    default:
      return ['START_VERIFICATION'];
  }
}
```

- [ ] **Step 4: Re-run the helper tests and confirm the new contract passes**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/customer-status.util.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/identity/customer-status.util.spec.ts
```

- [ ] **Step 5: Commit only the helper changes**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add src/modules/identity/customer-status.util.ts src/modules/identity/customer-status.util.spec.ts
git commit -m "refactor: collapse onboarding canonical status model"
```

## Task 2: Persist Sumsub Verification Projection and Customer Filter Compatibility

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/migrations/20260405123000_wave3_sumsub_onboarding_projection/migration.sql`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.controller.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.controller.spec.ts`

- [ ] **Step 1: Write failing controller specs for legacy onboarding filters**

```ts
it('maps legacy PENDING_CDD filter to canonical PENDING_VERIFICATION', () => {
  controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'PENDING_CDD');

  expect(customersServiceMock.findAll).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
          }),
        ]),
      }),
    }),
  );
});

it('maps legacy REVIEW_EDD filter to canonical PENDING_VERIFICATION', () => {
  controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'REVIEW_EDD');

  expect(customersServiceMock.findAll).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
          }),
        ]),
      }),
    }),
  );
});
```

- [ ] **Step 2: Run the controller spec and confirm the legacy mappings fail**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/customers/customers.controller.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/customers/customers.controller.spec.ts
```

- [ ] **Step 3: Add onboarding projection fields and remap active onboarding rows**

```prisma
onboardingStatus                String    @default("NONE") // NONE, PENDING_VERIFICATION, FINAL_APPROVAL, APPROVED, REJECTED, WITHDRAWN
verificationProvider            String?
verificationSubstatus           String?
verificationCustomerActionRequired Boolean @default(false)
verificationCanContinue         Boolean   @default(false)
verificationLatestEventType     String?
verificationLatestEventAt       DateTime?
sumsubApplicantId               String?   @unique
sumsubCurrentLevelName          String?
sumsubLatestReviewId            String?
sumsubLatestAttemptId           String?
sumsubExperiencedLevel2         Boolean   @default(false)
```

```sql
ALTER TABLE "customer_main" ADD COLUMN "verificationProvider" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationSubstatus" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationCustomerActionRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_main" ADD COLUMN "verificationCanContinue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_main" ADD COLUMN "verificationLatestEventType" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationLatestEventAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "sumsubApplicantId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubCurrentLevelName" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubLatestReviewId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubLatestAttemptId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubExperiencedLevel2" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");

UPDATE "customer_main"
SET "onboardingStatus" = 'PENDING_VERIFICATION'
WHERE "onboardingStatus" IN ('PENDING_CDD_INPUT', 'CDD_UNDER_REVIEW', 'PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW');
```

```ts
switch (normalized) {
  case 'PENDING_CDD':
  case 'REVIEW_CDD':
  case 'PENDING_EDD':
  case 'REVIEW_EDD':
  case 'PENDING_VERIFICATION':
    return { onboardingStatus: 'PENDING_VERIFICATION' };
  default:
    return { onboardingStatus: normalized };
}
```

- [ ] **Step 4: Generate the Prisma client and re-run the controller spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run prisma:generate
npm test -- src/modules/identity/customers/customers.controller.spec.ts --runInBand
```

Expected:

```text
✔ Generated Prisma Client
PASS src/modules/identity/customers/customers.controller.spec.ts
```

- [ ] **Step 5: Commit schema and controller compatibility updates**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add prisma/schema.prisma prisma/migrations/20260405123000_wave3_sumsub_onboarding_projection/migration.sql src/modules/identity/customers/customers.controller.ts src/modules/identity/customers/customers.controller.spec.ts
git commit -m "feat: persist sumsub onboarding projection fields"
```

## Task 3: Add the Thin Onboarding Sumsub Client

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.types.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.module.ts`

- [ ] **Step 1: Write a failing client spec for request signing and minimal onboarding methods**

```ts
it('signs createApplicant requests with Sumsub headers', async () => {
  const post = jest.fn().mockResolvedValue({ data: { id: 'app-1' } });
  mockedAxios.create.mockReturnValue({ post } as any);

  const client = new SumsubClient();
  await client.createApplicant({
    externalUserId: 'customer-1',
    levelName: 'wave3-level-1',
  });

  expect(post).toHaveBeenCalledWith(
    '/resources/applicants?levelName=wave3-level-1',
    expect.objectContaining({ externalUserId: 'customer-1' }),
    expect.objectContaining({
      headers: expect.objectContaining({
        'X-App-Token': expect.any(String),
        'X-App-Access-Ts': expect.any(String),
        'X-App-Access-Sig': expect.any(String),
      }),
    }),
  );
});

it('calls changeLevel for level escalation', async () => {
  const post = jest.fn().mockResolvedValue({ data: {} });
  mockedAxios.create.mockReturnValue({ post } as any);

  const client = new SumsubClient();
  await client.changeLevel('app-1', 'wave3-level-2');

  expect(post).toHaveBeenCalledWith(
    '/resources/applicants/app-1/moveToLevel?name=wave3-level-2',
    {},
    expect.any(Object),
  );
});
```

- [ ] **Step 2: Run the new client spec and confirm it fails because the client does not exist yet**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts
Cannot find module './sumsub.client'
```

- [ ] **Step 3: Implement the onboarding-only Sumsub client and types**

```ts
export type SumsubVerificationSubstatus =
  | 'NOT_STARTED'
  | 'CREATED'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'UNDER_REVIEW'
  | 'RESUBMIT_REQUIRED'
  | 'NEXT_LEVEL_REQUIRED'
  | 'CUSTOMER_ACTION_REQUIRED'
  | 'ACTION_UNDER_REVIEW'
  | 'COMPLETED'
  | 'FAILED';

@Injectable()
export class SumsubClient {
  private readonly baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  private readonly appToken = process.env.SUMSUB_APP_TOKEN || '';
  private readonly secretKey = process.env.SUMSUB_SECRET_KEY || '';
  private readonly http = axios.create({ baseURL: this.baseUrl, timeout: 10000 });

  async createApplicant(input: { externalUserId: string; levelName: string }) {
    return this.post(
      `/resources/applicants?levelName=${encodeURIComponent(input.levelName)}`,
      { externalUserId: input.externalUserId },
    );
  }

  async createSdkToken(input: { applicantId: string; levelName: string }) {
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,
      levelName: input.levelName,
      ttlInSecs: 600,
    });
  }

  async getApplicantReviewStatus(applicantId: string) {
    return this.get(`/resources/applicants/${applicantId}/requiredIdDocsStatus`);
  }

  async changeLevel(applicantId: string, levelName: string) {
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      {},
    );
  }
}
```

- [ ] **Step 4: Register the client in the onboarding module and re-run the client spec**

```ts
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
```

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts
```

- [ ] **Step 5: Commit the thin client**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add src/modules/identity/onboarding/providers/sumsub/sumsub.types.ts src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts src/modules/identity/onboarding/onboarding.module.ts
git commit -m "feat: add onboarding sumsub client"
```

## Task 4: Add Real Webhook Intake and Simulation Transport

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/main.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.module.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/dto/onboarding.dto.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts`

- [ ] **Step 1: Write failing controller specs for real webhook dispatch and simulated event dispatch**

```ts
it('passes raw webhook payload to onboarding service after signature validation', async () => {
  const service = { handleSumsubVerificationEvent: jest.fn().mockResolvedValue({ ok: true }) } as any;
  const controller = new OnboardingSumsubWebhookController(service);

  await controller.handleWebhook(
    { rawBody: Buffer.from('{"type":"applicantPending"}') } as any,
    { type: 'applicantPending', applicantId: 'app-1' } as any,
    'sha256=test-signature',
  );

  expect(service.handleSumsubVerificationEvent).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'applicantPending', applicantId: 'app-1' }),
    expect.objectContaining({ rawBody: expect.any(Buffer) }),
  );
});

it('builds a simulated Sumsub payload and routes it to the same service method', async () => {
  const service = { handleSumsubVerificationEvent: jest.fn().mockResolvedValue({ ok: true }) } as any;
  const controller = new OnboardingSumsubSimulationController(service);

  await controller.simulate(
    { user: { type: 'CUSTOMER', userId: 'customer-1' } } as any,
    { eventType: 'applicantWorkflowCompleted', levelName: 'wave3-level-2' } as any,
  );

  expect(service.handleSumsubVerificationEvent).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'applicantWorkflowCompleted' }),
    expect.objectContaining({ simulated: true, actorId: 'customer-1' }),
  );
});
```

- [ ] **Step 2: Run the new controller specs and confirm they fail**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts
FAIL src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts
```

- [ ] **Step 3: Enable raw-body parsing and add both controllers**

```ts
const app = await NestFactory.create(AppModule, {
  bufferLogs: true,
  rawBody: true,
});
```

```ts
@Controller('onboarding/sumsub')
export class OnboardingSumsubWebhookController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: any,
    @Body() body: SumsubWebhookEvent,
    @Headers('x-payload-digest') signature?: string,
  ) {
    return this.onboardingService.handleSumsubVerificationEvent(body, {
      rawBody: req.rawBody,
      signature,
      simulated: false,
      actorId: 'SUMSUB',
    });
  }
}

@Controller('onboarding/sumsub')
@UseGuards(AuthGuard('jwt'))
export class OnboardingSumsubSimulationController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('simulate')
  async simulate(@Req() req: any, @Body() body: SimulateOnboardingSumsubEventDto) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.onboardingService.handleSumsubVerificationEvent(
      buildSimulatedSumsubEvent(req.user.userId, body),
      {
        simulated: true,
        actorId: req.user.userId,
      },
    );
  }
}
```

- [ ] **Step 4: Register the controllers and re-run their specs**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts
PASS src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts
```

- [ ] **Step 5: Commit webhook transport plumbing**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add src/main.ts src/modules/identity/onboarding/onboarding.module.ts src/modules/identity/onboarding/dto/onboarding.dto.ts src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts
git commit -m "feat: add onboarding sumsub webhook transport"
```

## Task 5: Refactor Customer Onboarding Start and Read Models

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-customer.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/dto/onboarding.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`

- [ ] **Step 1: Write failing service tests for starting verification and returning the new projection**

```ts
it('starts onboarding verification by creating an applicant and moving the customer to PENDING_VERIFICATION', async () => {
  prismaMock.customerMain.findUnique.mockResolvedValue({
    id: 'c1',
    customerNo: 'CU0001',
    onboardingStatus: 'NONE',
    operatingStatus: 'INACTIVE',
    restrictionStatus: 'CLEAR',
    sumsubApplicantId: null,
  });
  prismaMock.customerMain.update.mockResolvedValue({
    id: 'c1',
    onboardingStatus: 'PENDING_VERIFICATION',
    verificationProvider: 'SUMSUB',
    verificationSubstatus: 'CREATED',
  });
  sumsubClientMock.createApplicant.mockResolvedValue({ id: 'app-1' });
  sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-1' });

  const result = await service.startVerification('c1');

  expect(result.customer.onboardingStatus).toBe('PENDING_VERIFICATION');
  expect(result.verification.applicantId).toBe('app-1');
  expect(result.verification.sdkToken).toBe('sdk-token-1');
});

it('projects CONTINUE_VERIFICATION when provider substatus requires customer continuation', async () => {
  prismaMock.customerMain.findUnique.mockResolvedValue({
    id: 'c1',
    onboardingStatus: 'PENDING_VERIFICATION',
    operatingStatus: 'INACTIVE',
    restrictionStatus: 'CLEAR',
    verificationProvider: 'SUMSUB',
    verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
    verificationCustomerActionRequired: true,
    verificationCanContinue: true,
  });

  const nextStep = await service.getNextStep('c1');
  expect(nextStep.actions).toEqual([{ type: 'CONTINUE_VERIFICATION' }]);
});
```

- [ ] **Step 2: Run the onboarding service spec and confirm the new cases fail**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding.service.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/onboarding/onboarding.service.spec.ts
```

- [ ] **Step 3: Add the new start endpoint and provider-first onboarding read model**

```ts
@Post('verification/start')
@ApiOperation({ summary: 'Start or continue provider-backed onboarding verification.' })
startVerification(@Req() req: any) {
  const customerId = this.ensureCustomer(req);
  return this.onboardingService.startVerification(customerId);
}
```

```ts
async startVerification(customerId: string) {
  const customer = await this.getCustomerOrThrow(customerId);
  const currentLevel = customer.sumsubCurrentLevelName || this.getLevel1Name();

  let applicantId = customer.sumsubApplicantId || null;
  if (!applicantId) {
    applicantId =
      (await this.sumsubClient.getApplicantByExternalUserId(customerId))?.id ||
      (
        await this.sumsubClient.createApplicant({
          externalUserId: customerId,
          levelName: currentLevel,
        })
      ).id;
  }

  const sdkToken = await this.sumsubClient.createSdkToken({
    externalUserId: customerId,
    levelName: currentLevel,
  });

  const data: Prisma.CustomerMainUpdateInput = {
    onboardingStatus: 'PENDING_VERIFICATION',
    verificationProvider: 'SUMSUB',
    verificationSubstatus: 'CREATED',
    verificationCanContinue: true,
    verificationCustomerActionRequired: true,
    sumsubApplicantId: applicantId,
    sumsubCurrentLevelName: currentLevel,
  };

  if (customer.onboardingStatus === 'REJECTED' || customer.onboardingStatus === 'WITHDRAWN') {
    data.sumsubExperiencedLevel2 = false;
    data.sumsubLatestReviewId = null;
    data.sumsubLatestAttemptId = null;
    data.verificationLatestEventType = null;
    data.verificationLatestEventAt = null;
    data.latestFinalApproval = { disconnect: true };
    data.latestFinalApprovalStatus = null;
  }

  const updated = await this.prisma.customerMain.update({
    where: { id: customerId },
    data,
  });
  const nextStep = await this.buildNextStep(updated);

  return {
    customer: this.buildCustomerSnapshot(updated),
    nextStep,
    verification: {
      ...nextStep.verification,
      sdkToken: sdkToken.token,
    },
  };
}
```

- The start endpoint returns a narrow onboarding snapshot:
  - `customer`: canonical lifecycle statuses only
  - `nextStep`: the current customer-facing next-step snapshot
  - `verification`: provider projection plus `sdkToken`
- If the local row has lost `sumsubApplicantId`, the service must first try recovering the remote applicant by `externalUserId=customerId` before creating a new applicant.
- Re-initiation from `REJECTED / WITHDRAWN` must reset the current provider run projection, including `latestReviewId`, `latestAttemptId`, and the latest provider event metadata, before the new run starts.

- [ ] **Step 4: Mark old `CDD/EDD/session` customer endpoints as legacy in Swagger summaries, but keep them temporarily for compatibility**

```ts
@ApiOperation({ summary: '[Legacy] Start CDD journey through local response/session path.' })
bootstrapCddResponses(...) { ... }

@ApiOperation({ summary: '[Legacy] Mock local response session completion. Not canonical for Sumsub onboarding.' })
mockCompleteResponseSession(...) { ... }
```

- [ ] **Step 5: Re-run the onboarding service spec and confirm start/read behavior passes**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding.service.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/identity/onboarding/onboarding.service.spec.ts
```

- [ ] **Step 6: Commit the start/read-model refactor**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add src/modules/identity/onboarding/onboarding-customer.controller.ts src/modules/identity/onboarding/dto/onboarding.dto.ts src/modules/identity/onboarding/onboarding.service.ts src/modules/identity/onboarding/onboarding.service.spec.ts
git commit -m "refactor: start onboarding from sumsub verification"
```

## Task 6: Implement Webhook-Driven Onboarding Transitions and Level 2 Final Approval Branching

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`
- Modify if needed: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts`
- Test if needed: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`

- [ ] **Step 1: Add failing service tests for every onboarding branch that matters**

```ts
it('keeps onboarding pending when applicant enters manual review', async () => {
  await service.handleSumsubVerificationEvent(
    { type: 'applicantOnHold', applicantId: 'app-1', levelName: 'wave3-level-1' } as any,
    { simulated: false, actorId: 'SUMSUB' },
  );

  expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'UNDER_REVIEW',
      }),
    }),
  );
});

it('keeps onboarding pending when applicant needs resubmission', async () => {
  await service.handleSumsubVerificationEvent(
    {
      type: 'applicantReviewed',
      applicantId: 'app-1',
      reviewStatus: 'completed',
      reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
    } as any,
    { simulated: false, actorId: 'SUMSUB' },
  );

  expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'RESUBMIT_REQUIRED',
        verificationCanContinue: true,
      }),
    }),
  );
});

it('moves directly to APPROVED when workflow completes without level2', async () => {
  prismaMock.customerMain.findUnique.mockResolvedValue({
    id: 'c1',
    customerNo: 'CU0001',
    onboardingStatus: 'PENDING_VERIFICATION',
    operatingStatus: 'INACTIVE',
    restrictionStatus: 'CLEAR',
    sumsubExperiencedLevel2: false,
  });

  await service.handleSumsubVerificationEvent(
    { type: 'applicantWorkflowCompleted', applicantId: 'app-1' } as any,
    { simulated: false, actorId: 'SUMSUB' },
  );

  expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
      }),
    }),
  );
});

it('moves to FINAL_APPROVAL when workflow completes after level2', async () => {
  prismaMock.customerMain.findUnique.mockResolvedValue({
    id: 'c1',
    customerNo: 'CU0001',
    onboardingStatus: 'PENDING_VERIFICATION',
    operatingStatus: 'INACTIVE',
    restrictionStatus: 'CLEAR',
    sumsubExperiencedLevel2: true,
  });

  await service.handleSumsubVerificationEvent(
    { type: 'applicantWorkflowCompleted', applicantId: 'app-1' } as any,
    { simulated: false, actorId: 'SUMSUB' },
  );

  expect(onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the onboarding service spec again and confirm these webhook transitions fail before implementation**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding.service.spec.ts --runInBand
```

Expected:

```text
FAIL src/modules/identity/onboarding/onboarding.service.spec.ts
```

- [ ] **Step 3: Implement a single webhook event handler that updates both lifecycle and verification projection**

```ts
async handleSumsubVerificationEvent(
  event: SumsubWebhookEvent,
  context: { rawBody?: Buffer; signature?: string; simulated: boolean; actorId: string },
) {
  const customer = await this.findCustomerByApplicantOrThrow(event);

  switch (event.type) {
    case 'applicantPending':
      return this.updateVerificationProjection(customer.id, {
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'SUBMITTED',
        verificationCanContinue: false,
        verificationCustomerActionRequired: false,
      });
    case 'applicantOnHold':
      return this.updateVerificationProjection(customer.id, {
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'UNDER_REVIEW',
        verificationCanContinue: false,
        verificationCustomerActionRequired: false,
      });
    case 'applicantReviewed':
      return this.handleApplicantReviewed(customer, event);
    case 'applicantLevelChanged':
      return this.updateVerificationProjection(customer.id, {
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
        verificationCanContinue: true,
        verificationCustomerActionRequired: true,
        sumsubCurrentLevelName: event.levelName || customer.sumsubCurrentLevelName,
        sumsubExperiencedLevel2:
          customer.sumsubExperiencedLevel2 || this.isLevel2(event.levelName),
      });
    case 'applicantWorkflowCompleted':
      return this.handleWorkflowCompleted(customer, context.actorId);
    case 'applicantWorkflowFailed':
      return this.updateVerificationProjection(customer.id, {
        onboardingStatus: 'REJECTED',
        verificationSubstatus: 'FAILED',
        verificationCanContinue: false,
        verificationCustomerActionRequired: false,
      });
    default:
      return this.updateVerificationProjection(customer.id, {
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'PROCESSING',
      });
  }
}
```

- [ ] **Step 4: Make `level2` workflow completion hand off to final approval, and keep `level1` completion direct-to-active**

```ts
private async handleWorkflowCompleted(customer: CustomerProjectionRow, actorId: string) {
  if (customer.sumsubExperiencedLevel2) {
    return this.prisma.$transaction(async (tx) => {
      await tx.customerMain.update({
        where: { id: customer.id },
        data: {
          onboardingStatus: 'FINAL_APPROVAL',
          operatingStatus: 'INACTIVE',
          verificationSubstatus: 'COMPLETED',
          verificationCanContinue: false,
          verificationCustomerActionRequired: false,
        },
      });

      return this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(
        tx,
        customer.id,
        actorId,
        'Sumsub workflow completed after level2',
      );
    });
  }

  return this.prisma.customerMain.update({
    where: { id: customer.id },
    data: {
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      verificationSubstatus: 'COMPLETED',
      verificationCanContinue: false,
      verificationCustomerActionRequired: false,
    },
  });
}
```

- [ ] **Step 5: Re-run the onboarding service spec and the final approval service spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/onboarding/onboarding.service.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/identity/onboarding/onboarding.service.spec.ts
PASS src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
```

- [ ] **Step 6: Commit the webhook-driven business transitions**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add src/modules/identity/onboarding/onboarding.service.ts src/modules/identity/onboarding/onboarding.service.spec.ts src/modules/identity/onboarding/onboarding-final-approval.service.ts src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
git commit -m "feat: drive onboarding from sumsub workflow events"
```

## Task 7: Update the Verification Frontend to Use Provider-First Onboarding

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web/src/utils/customerOnboarding.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web/src/pages/Verification.tsx`

- [ ] **Step 1: Replace frontend canonical status unions and action names**

```ts
export type CanonicalOnboardingStatus =
  | 'NONE'
  | 'PENDING_VERIFICATION'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export const isCustomerInProgress = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  return ['NONE', 'PENDING_VERIFICATION', 'FINAL_APPROVAL'].includes(onboardingStatus || 'NONE');
};
```

```ts
type VerificationStep = 'ENTITY_INFO' | 'VERIFY' | 'WAIT_REVIEW' | 'REINITIATE' | 'COMPLETED';
type VerificationAction =
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';
```

- [ ] **Step 2: Replace old `CDD/EDD/session` start paths with the new provider-first start endpoint**

```ts
const startVerification = async () => {
  const response = await customerFetch(`${import.meta.env.VITE_API_URL}/onboarding/verification/start`, {
    method: 'POST',
  });
  const data = await response.json();
  setOnboarding(data.customer);
  setNextStep(data.nextStep);
  setVerificationSession(data.verification);
};
```

```ts
if (onboardingStatus === 'PENDING_VERIFICATION') {
  return {
    step: verification?.customerActionRequired ? 'VERIFY' : 'WAIT_REVIEW',
    action: verification?.canContinue ? 'CONTINUE_VERIFICATION' : 'WAIT',
    blockedReason,
    activeCaseId: null,
    requiresEdd: Boolean(verification?.experiencedLevel2),
    actions,
  };
}
```

- [ ] **Step 3: Replace old mock session completion buttons with Sumsub simulation buttons**

```ts
const simulateVerificationEvent = async (eventType: string, levelName?: string) => {
  await customerFetch(`${import.meta.env.VITE_API_URL}/onboarding/sumsub/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, levelName }),
  });
  await refreshOnboarding();
};
```

```tsx
{simulationMode.enabled && currentStep.action === 'CONTINUE_VERIFICATION' && (
  <button onClick={() => simulateVerificationEvent('applicantWorkflowCompleted')}>
    Simulate workflow completion
  </button>
)}
```

- [ ] **Step 4: Build the frontend and manually verify the happy path and level2 path**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web
npm run build
```

Expected:

```text
vite build
✓ built in
```

Manual verification checklist:

```text
1. Customer with onboardingStatus=NONE sees "Start verification".
2. Simulated applicantOnHold keeps status pending and shows a waiting screen.
3. Simulated applicantLevelChanged keeps status pending and enables continue verification.
4. Simulated applicantWorkflowCompleted after level1 shows approved flow.
5. Simulated applicantWorkflowCompleted after level2 shows final approval waiting flow.
```

- [ ] **Step 5: Commit the frontend adaptation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add client-web/src/utils/customerOnboarding.ts client-web/src/pages/Verification.tsx
git commit -m "refactor: adapt onboarding ui to sumsub workflow"
```

## Task 8: Rewrite Canonical Wave 3 Onboarding Documentation and Run Final Verification

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/customer-onboarding-module.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/onboarding-canonical-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/onboarding-flow-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`

- [ ] **Step 1: Update the docs so they match the new canonical lifecycle**

```md
- Replace `PENDING_CDD_INPUT / CDD_UNDER_REVIEW / PENDING_EDD_INPUT / EDD_UNDER_REVIEW`
  with `PENDING_VERIFICATION`.
- State that Sumsub workflow is the verification truth source.
- State that only `level2` completion leads to `FINAL_APPROVAL`.
- State that `level1`-only completion can directly activate the customer.
- State that simulation now mimics Sumsub webhooks instead of mock session completion.
```

- [ ] **Step 2: Run the fastest relevant backend and frontend verification set**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/identity/customer-status.util.spec.ts --runInBand
npm test -- src/modules/identity/customers/customers.controller.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding.service.spec.ts --runInBand
npm test -- src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts --runInBand
npm run build
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web
npm run build
```

Expected:

```text
PASS src/modules/identity/customer-status.util.spec.ts
PASS src/modules/identity/customers/customers.controller.spec.ts
PASS src/modules/identity/onboarding/providers/sumsub/sumsub.client.spec.ts
PASS src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts
PASS src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.spec.ts
PASS src/modules/identity/onboarding/onboarding.service.spec.ts
PASS src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
nest build
vite build
```

- [ ] **Step 3: Commit docs and final verification-safe changes**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add docs/roadmap/wave-3-customer-onboarding-phase-plan.md docs/specs/modules/customer-onboarding-module.md docs/specs/workflows/onboarding-canonical-workflow.md docs/constraints/onboarding-flow-constraints.md docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md
git commit -m "docs: align wave3 onboarding with sumsub workflow"
```

## Notes for Execution

- Do not delete `cddResponse`, `eddResponse`, `workflow transition`, or local risk-engine files in this slice. Leave them compiling but non-canonical.
- Prefer adding new onboarding-specific methods instead of rewriting every legacy code path in one patch.
- When executing from a dirty worktree, stage only the files listed in the current task.
- If Sumsub live credentials are unavailable, use the simulation controller and unit tests to verify the provider-first flow.
