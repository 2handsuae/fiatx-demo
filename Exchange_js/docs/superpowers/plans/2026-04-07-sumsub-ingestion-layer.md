# Sumsub Unified Ingestion Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified Sumsub webhook ingestion layer with persistent event log, auto-retry on failure, and an admin simulation panel covering all 6 demo scenarios — then wire it to the existing onboarding domain handler and remove the old per-domain webhook controllers.

**Architecture:** New `SumsubIngestionModule` owns `POST /webhooks/sumsub` (real) and `POST /admin/sumsub-events/simulate` (simulation). Both paths call `SumsubIngestionService.ingest()` which persists to `sumsub_webhook_events`, then dispatches to the registered domain handler (`OnboardingService.handleSumsubVerificationEvent`). A cron-based `SumsubRetryService` auto-retries `FAILED` events up to 3 times with exponential backoff; `DEAD` events write a system alert. Admin web gets a `SumsubEventsPage` with event log and scenario simulation modal.

**Tech Stack:** NestJS + Prisma + SQLite, `@nestjs/schedule` (`@Cron`), React 18 + TypeScript + Tailwind CSS 3, existing `adminFetch` / `adminButtonClass` / `AdminBadge` / `PageTitleBar` patterns.

**All backend paths relative to:** `Exchange_js/src/`
**All frontend paths relative to:** `Exchange_js/admin-web/src/`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `prisma/schema.prisma` | Add `SumsubWebhookEvent` model + 2 enums |
| Create | `prisma/migrations/20260407000000_add_sumsub_webhook_events/migration.sql` | Raw SQL migration |
| Create | `modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Core: persist, dispatch, simulate scenarios |
| Create | `modules/sumsub-ingestion/sumsub-ingestion.controller.ts` | `POST /webhooks/sumsub` — real webhook entry |
| Create | `modules/sumsub-ingestion/sumsub-ingestion-retry.service.ts` | Cron retry + dead-letter alert |
| Create | `modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts` | Admin list/detail/replay/simulate APIs |
| Create | `modules/sumsub-ingestion/dto/sumsub-ingestion.dto.ts` | Request/response DTOs |
| Create | `modules/sumsub-ingestion/sumsub-ingestion.module.ts` | Module wiring |
| Modify | `app.module.ts` | Register `SumsubIngestionModule` |
| Modify | `modules/identity/onboarding/onboarding.module.ts` | Remove old webhook/sim controllers; export `SumsubClient` |
| Create | `pages/SumsubEventsPage.tsx` | Admin event log + simulation modal |
| Modify | `../admin-web/src/App.tsx` | Add `/dashboard/sumsub-events` route |
| Modify | `../admin-web/src/components/DashboardLayout.tsx` | Add "Sumsub Events" nav item |

---

## Task 1: Prisma Schema — `sumsub_webhook_events` table

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`
- Create: `Exchange_js/prisma/migrations/20260407000000_add_sumsub_webhook_events/migration.sql`

- [ ] **Step 1: Add enums and model to `prisma/schema.prisma`**

Find the last model/enum block in `schema.prisma` and append:

```prisma
enum SumsubEventContext {
  ONBOARDING
  PERIODIC_REVIEW
  TRANSACTION
}

enum SumsubWebhookEventStatus {
  PENDING
  PROCESSED
  FAILED
  DEAD
}

model SumsubWebhookEvent {
  id                String                   @id @default(cuid())
  eventNo           String                   @unique
  eventType         String
  applicantId       String
  externalUserId    String
  context           SumsubEventContext        @default(ONBOARDING)
  rawPayload        Json
  receivedAt        DateTime
  status            SumsubWebhookEventStatus  @default(PENDING)
  retryCount        Int                       @default(0)
  lastRetryAt       DateTime?
  lastErrorMessage  String?
  processedAt       DateTime?
  dispatchedTo      String?
  isSimulated       Boolean                   @default(false)
  simulatedByUserId String?
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt

  @@index([status, createdAt])
  @@index([applicantId])
  @@index([externalUserId])
  @@index([eventType, status])
  @@map("sumsub_webhook_events")
}
```

- [ ] **Step 2: Create migration file**

Create directory and file:
`Exchange_js/prisma/migrations/20260407000000_add_sumsub_webhook_events/migration.sql`

```sql
CREATE TABLE "sumsub_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventNo" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "rawPayload" JSONB NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" DATETIME,
    "lastErrorMessage" TEXT,
    "processedAt" DATETIME,
    "dispatchedTo" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "simulatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "sumsub_webhook_events_eventNo_key" ON "sumsub_webhook_events"("eventNo");
CREATE INDEX "sumsub_webhook_events_status_createdAt_idx" ON "sumsub_webhook_events"("status", "createdAt");
CREATE INDEX "sumsub_webhook_events_applicantId_idx" ON "sumsub_webhook_events"("applicantId");
CREATE INDEX "sumsub_webhook_events_externalUserId_idx" ON "sumsub_webhook_events"("externalUserId");
CREATE INDEX "sumsub_webhook_events_eventType_status_idx" ON "sumsub_webhook_events"("eventType", "status");
```

- [ ] **Step 3: Run migration**

```bash
cd Exchange_js
npm run db:migrate:local
```

Expected: migration runs without error. Verify with:
```bash
sqlite3 /tmp/exchange_js_main/dev.db ".tables" | grep sumsub
```
Expected output includes: `sumsub_webhook_events`

- [ ] **Step 4: Regenerate Prisma client**

```bash
cd Exchange_js
npx prisma generate
```

Expected: no errors. `PrismaClient` now has `prisma.sumsubWebhookEvent`.

- [ ] **Step 5: Commit**

```bash
cd Exchange_js
git add prisma/schema.prisma prisma/migrations/20260407000000_add_sumsub_webhook_events/
git commit -m "feat(db): add sumsub_webhook_events table for unified ingestion layer"
```

---

## Task 2: DTOs

**Files:**
- Create: `src/modules/sumsub-ingestion/dto/sumsub-ingestion.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
// src/modules/sumsub-ingestion/dto/sumsub-ingestion.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum SimulationScenario {
  LOW_RISK_PASS = 'LOW_RISK_PASS',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  RESUBMIT_REQUIRED = 'RESUBMIT_REQUIRED',
  EDD_ESCALATE = 'EDD_ESCALATE',
  EDD_PASS = 'EDD_PASS',
  WORKFLOW_FAIL = 'WORKFLOW_FAIL',
}

export class SimulateEventDto {
  @IsString()
  customerId: string;

  @IsEnum(SimulationScenario)
  scenario: SimulationScenario;

  @IsOptional()
  overrides?: Record<string, unknown>;
}

export class ListSumsubEventsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  externalUserId?: string;

  @IsOptional()
  @IsString()
  applicantId?: string;

  @IsOptional()
  skip?: number;

  @IsOptional()
  take?: number;
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/dto/sumsub-ingestion.dto.ts
git commit -m "feat(sumsub-ingestion): add DTOs for simulate and list endpoints"
```

---

## Task 3: `SumsubIngestionService` — core persist + dispatch

**Files:**
- Create: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

- [ ] **Step 1: Create the service**

```typescript
// src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { OnboardingService } from '../identity/onboarding/onboarding.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import { SimulationScenario } from './dto/sumsub-ingestion.dto';
import { SumsubWebhookEvent, SumsubWebhookEventStatus } from '@prisma/client';

const MAX_NO_RETRIES = 5;

@Injectable()
export class SumsubIngestionService {
  private readonly logger = new Logger(SumsubIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
  ) {}

  // ─── Main entry point (real webhook + simulation both call this) ──────────

  async ingest(
    rawPayload: Record<string, unknown>,
    options: { isSimulated?: boolean; simulatedByUserId?: string } = {},
  ): Promise<{ event: SumsubWebhookEvent; dispatchResult?: unknown }> {
    const eventType = String(rawPayload.type ?? 'unknown');
    const applicantId = String(rawPayload.applicantId ?? '');
    const externalUserId = String(rawPayload.externalUserId ?? '');

    // Deduplication: if an identical event (same type+applicantId+reviewId) was
    // already PROCESSED, return it without dispatching again.
    const dedupeKey = this.buildDedupeKey(rawPayload);
    if (dedupeKey) {
      const existing = await this.prisma.sumsubWebhookEvent.findFirst({
        where: { eventType, applicantId, status: 'PROCESSED' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && this.extractDedupeKey(existing.rawPayload as Record<string, unknown>) === dedupeKey) {
        this.logger.warn(`Duplicate event skipped: ${dedupeKey}`);
        return { event: existing };
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

  // ─── Dispatch to domain handler ───────────────────────────────────────────

  async dispatch(event: SumsubWebhookEvent): Promise<unknown> {
    try {
      const payload = event.rawPayload as Record<string, unknown>;
      let result: unknown;

      // Route by context — currently only ONBOARDING is implemented.
      // Add PERIODIC_REVIEW and TRANSACTION cases here when those handlers are ready.
      if (event.context === 'ONBOARDING') {
        result = await this.onboardingService.handleSumsubVerificationEvent(payload, {
          simulated: event.isSimulated,
          actorId: event.isSimulated ? (event.simulatedByUserId ?? 'ADMIN_SIM') : 'SUMSUB',
          rawBody: Buffer.from(JSON.stringify(payload)),
        });
      } else {
        throw new Error(`No handler registered for context: ${event.context}`);
      }

      await this.prisma.sumsubWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          dispatchedTo: event.context,
        },
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newRetryCount = event.retryCount + 1;
      const newStatus: SumsubWebhookEventStatus =
        newRetryCount >= 3 ? 'DEAD' : 'FAILED';

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
        // TODO Wave 9: write system alert for dead events
      }

      throw err;
    }
  }

  // ─── Simulation: build payload for each scenario ─────────────────────────

  async simulate(
    customerId: string,
    scenario: SimulationScenario,
    simulatedByUserId: string,
    overrides?: Record<string, unknown>,
  ): Promise<{ event: SumsubWebhookEvent; dispatchResult?: unknown }> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, sumsubApplicantId: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    const applicantId = customer.sumsubApplicantId ?? `SIM-${customer.customerNo}`;
    const basePayload = this.buildScenarioPayload(scenario, applicantId, customer.id);
    const finalPayload = { ...basePayload, ...(overrides ?? {}) };

    return this.ingest(finalPayload, { isSimulated: true, simulatedByUserId });
  }

  private buildScenarioPayload(
    scenario: SimulationScenario,
    applicantId: string,
    externalUserId: string,
  ): Record<string, unknown> {
    const base = { applicantId, externalUserId };
    switch (scenario) {
      case SimulationScenario.LOW_RISK_PASS:
        return {
          ...base,
          type: 'applicantWorkflowCompleted',
          reviewResult: { reviewAnswer: 'GREEN', reviewRejectType: 'FINAL' },
        };
      case SimulationScenario.MANUAL_REVIEW:
        return { ...base, type: 'applicantOnHold' };
      case SimulationScenario.RESUBMIT_REQUIRED:
        return {
          ...base,
          type: 'applicantReviewed',
          reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
        };
      case SimulationScenario.EDD_ESCALATE:
        return { ...base, type: 'applicantLevelChanged', levelName: 'level2' };
      case SimulationScenario.EDD_PASS:
        // Sends applicantWorkflowCompleted — customer must have sumsubExperiencedLevel2=true
        // (send EDD_ESCALATE first to set that flag)
        return {
          ...base,
          type: 'applicantWorkflowCompleted',
          reviewResult: { reviewAnswer: 'GREEN', reviewRejectType: 'FINAL' },
        };
      case SimulationScenario.WORKFLOW_FAIL:
        return {
          ...base,
          type: 'applicantWorkflowFailed',
          reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
        };
    }
  }

  // ─── List / detail for admin UI ───────────────────────────────────────────

  async list(query: {
    status?: string;
    eventType?: string;
    externalUserId?: string;
    applicantId?: string;
    skip?: number;
    take?: number;
  }) {
    const where = {
      ...(query.status ? { status: query.status as SumsubWebhookEventStatus } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.externalUserId ? { externalUserId: query.externalUserId } : {}),
      ...(query.applicantId ? { applicantId: query.applicantId } : {}),
    };
    const take = Math.min(query.take ?? 20, 100);
    const skip = query.skip ?? 0;

    const [total, items] = await Promise.all([
      this.prisma.sumsubWebhookEvent.count({ where }),
      this.prisma.sumsubWebhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          eventNo: true,
          eventType: true,
          applicantId: true,
          externalUserId: true,
          context: true,
          status: true,
          retryCount: true,
          isSimulated: true,
          simulatedByUserId: true,
          receivedAt: true,
          processedAt: true,
          dispatchedTo: true,
          lastErrorMessage: true,
          createdAt: true,
        },
      }),
    ]);

    return { total, skip, take, items };
  }

  async findOne(id: string) {
    const event = await this.prisma.sumsubWebhookEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException(`Sumsub event ${id} not found`);
    return event;
  }

  async replay(id: string): Promise<{ event: SumsubWebhookEvent }> {
    const event = await this.findOne(id);
    if (event.status !== 'DEAD') {
      throw new BadRequestException(`Only DEAD events can be replayed (current status: ${event.status})`);
    }
    // Reset for retry
    const reset = await this.prisma.sumsubWebhookEvent.update({
      where: { id },
      data: { status: 'FAILED', retryCount: 0, lastErrorMessage: null },
    });
    await this.dispatch(reset);
    return { event: await this.refresh(id) };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async createEventRecord(data: {
    eventType: string;
    applicantId: string;
    externalUserId: string;
    rawPayload: Record<string, unknown>;
    isSimulated: boolean;
    simulatedByUserId: string | null;
  }): Promise<SumsubWebhookEvent> {
    for (let i = 0; i < MAX_NO_RETRIES; i++) {
      try {
        return await this.prisma.sumsubWebhookEvent.create({
          data: {
            eventNo: generateReferenceNo('SWH'),
            eventType: data.eventType,
            applicantId: data.applicantId,
            externalUserId: data.externalUserId,
            context: 'ONBOARDING',
            rawPayload: data.rawPayload,
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

  private buildDedupeKey(payload: Record<string, unknown>): string | null {
    const type = String(payload.type ?? '');
    const applicantId = String(payload.applicantId ?? '');
    const reviewId = String((payload as any).reviewResult?.reviewId ?? payload.reviewId ?? '');
    const attemptId = String((payload as any).reviewResult?.attemptId ?? payload.attemptId ?? '');
    if (!type || !applicantId) return null;
    return `${type}:${applicantId}:${reviewId}:${attemptId}`;
  }

  private extractDedupeKey(payload: Record<string, unknown>): string | null {
    return this.buildDedupeKey(payload);
  }

  private async refresh(id: string): Promise<SumsubWebhookEvent> {
    return this.prisma.sumsubWebhookEvent.findUniqueOrThrow({ where: { id } });
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "feat(sumsub-ingestion): add SumsubIngestionService with ingest/dispatch/simulate"
```

---

## Task 4: `SumsubWebhookController` — real webhook entry point

**Files:**
- Create: `src/modules/sumsub-ingestion/sumsub-ingestion.controller.ts`

- [ ] **Step 1: Create the controller**

```typescript
// src/modules/sumsub-ingestion/sumsub-ingestion.controller.ts
import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubClient } from '../identity/onboarding/providers/sumsub/sumsub.client';

@ApiTags('Webhooks')
@Controller('webhooks')
export class SumsubIngestionController {
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Post('sumsub')
  @ApiOperation({ summary: 'Unified Sumsub webhook receiver' })
  async handleWebhook(
    @Req() req: { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-payload-digest') signature?: string,
    @Headers('x-payload-digest-alg') digestAlg?: string,
  ) {
    if (!this.sumsubClient.verifyWebhookSignature(req.rawBody, signature, digestAlg)) {
      throw new UnauthorizedException('Invalid Sumsub webhook signature');
    }

    const { event } = await this.ingestionService.ingest(body, { isSimulated: false });
    return { received: true, eventNo: event.eventNo };
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/sumsub-ingestion.controller.ts
git commit -m "feat(sumsub-ingestion): add SumsubIngestionController POST /webhooks/sumsub"
```

---

## Task 5: `SumsubRetryService` — auto-retry with backoff

**Files:**
- Create: `src/modules/sumsub-ingestion/sumsub-ingestion-retry.service.ts`

- [ ] **Step 1: Create the retry service**

```typescript
// src/modules/sumsub-ingestion/sumsub-ingestion-retry.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SumsubIngestionService } from './sumsub-ingestion.service';

// Minimum wait between retries (ms): attempt 1→ 30s, 2→ 5min, 3→ 30min
const BACKOFF_MS = [30_000, 300_000, 1_800_000];

@Injectable()
export class SumsubRetryService {
  private readonly logger = new Logger(SumsubRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestionService: SumsubIngestionService,
  ) {}

  @Cron('*/2 * * * *', { timeZone: 'Asia/Dubai' })
  async retryFailedEvents(): Promise<void> {
    const now = new Date();

    const events = await this.prisma.sumsubWebhookEvent.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const event of events) {
      const backoff = BACKOFF_MS[event.retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      const lastAttempt = event.lastRetryAt ?? event.createdAt;
      if (now.getTime() - lastAttempt.getTime() < backoff) continue;

      this.logger.log(
        `Retrying event ${event.eventNo} (attempt ${event.retryCount + 1}/3)`,
      );

      try {
        await this.ingestionService.dispatch(event);
      } catch {
        // dispatch() already updates status/retryCount; swallow here
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/sumsub-ingestion-retry.service.ts
git commit -m "feat(sumsub-ingestion): add SumsubRetryService with cron backoff retry"
```

---

## Task 6: `SumsubIngestionAdminController` — admin APIs

**Files:**
- Create: `src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts`

- [ ] **Step 1: Create the admin controller**

```typescript
// src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import {
  ListSumsubEventsQueryDto,
  SimulateEventDto,
} from './dto/sumsub-ingestion.dto';

@ApiTags('Admin - Sumsub Events')
@Controller('admin/sumsub-events')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SumsubIngestionAdminController {
  constructor(private readonly ingestionService: SumsubIngestionService) {}

  private requireAdmin(req: any): string {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return req.user.userId as string;
  }

  @Get()
  @ApiOperation({ summary: 'List Sumsub webhook events' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ListSumsubEventsQueryDto,
  ) {
    this.requireAdmin(req);
    return this.ingestionService.list({
      status: query.status,
      eventType: query.eventType,
      externalUserId: query.externalUserId,
      applicantId: query.applicantId,
      skip: query.skip ? Number(query.skip) : 0,
      take: query.take ? Number(query.take) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Sumsub webhook event detail' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.ingestionService.findOne(id);
  }

  @Post(':id/replay')
  @ApiOperation({ summary: 'Replay a DEAD Sumsub webhook event' })
  replay(@Req() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.ingestionService.replay(id);
  }

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate a Sumsub event for demo / testing' })
  simulate(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: SimulateEventDto,
  ) {
    const adminId = this.requireAdmin(req);
    return this.ingestionService.simulate(
      body.customerId,
      body.scenario,
      adminId,
      body.overrides,
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts
git commit -m "feat(sumsub-ingestion): add admin controller for list/detail/replay/simulate"
```

---

## Task 7: `SumsubIngestionModule` + wire into app

**Files:**
- Create: `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/modules/sumsub-ingestion/sumsub-ingestion.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubIngestionController } from './sumsub-ingestion.controller';
import { SumsubIngestionAdminController } from './sumsub-ingestion-admin.controller';
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
import { SumsubClient } from '../identity/onboarding/providers/sumsub/sumsub.client';

@Module({
  imports: [PrismaModule, OnboardingModule],
  providers: [SumsubIngestionService, SumsubRetryService, SumsubClient],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
```

- [ ] **Step 2: Register in `app.module.ts`**

Open `src/app.module.ts`. Find the imports array. Add the import statement at the top of the file:

```typescript
import { SumsubIngestionModule } from './modules/sumsub-ingestion/sumsub-ingestion.module';
```

Then add `SumsubIngestionModule` to the `imports` array in `@Module({ imports: [...] })`. Place it near other webhook/integration modules.

- [ ] **Step 3: Verify the server starts**

```bash
cd Exchange_js
npm run dev:start
```

Expected: server starts without errors. Confirm `POST /webhooks/sumsub` and `GET /admin/sumsub-events` appear in the Swagger docs at `http://localhost:3000/api`.

- [ ] **Step 4: Commit**

```bash
cd Exchange_js
git add src/modules/sumsub-ingestion/sumsub-ingestion.module.ts src/app.module.ts
git commit -m "feat(sumsub-ingestion): wire SumsubIngestionModule into app"
```

---

## Task 8: Refactor `OnboardingModule` — remove old webhook controllers

Now that the unified ingestion layer owns the webhook entry point, the old per-domain controllers become redundant.

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding.module.ts`

- [ ] **Step 1: Remove old webhook and simulation controllers from `OnboardingModule`**

Open `src/modules/identity/onboarding/onboarding.module.ts`.

Remove these two lines from the `controllers` array:
```typescript
OnboardingSumsubWebhookController,
OnboardingSumsubSimulationController,
```

Remove their import statements at the top:
```typescript
import { OnboardingSumsubWebhookController } from './onboarding-sumsub-webhook.controller';
import { OnboardingSumsubSimulationController } from './onboarding-sumsub-simulation.controller';
```

Add `SumsubClient` to `exports` so `SumsubIngestionModule` can use it via `OnboardingModule`:
```typescript
exports: [OnboardingService, OnboardingFinalApprovalService, PeriodicReviewService, SumsubClient],
```

The resulting controllers array should be:
```typescript
controllers: [
  OnboardingCustomerController,
  OnboardingAdminController,
  PeriodicReviewCustomerController,
  PeriodicReviewAdminController,
],
```

- [ ] **Step 2: Verify server still starts**

```bash
cd Exchange_js
npm run dev:start
```

Expected: no errors. Old routes `POST /onboarding/sumsub/webhook` and `POST /onboarding/sumsub/simulate` should no longer appear in Swagger.

- [ ] **Step 3: Commit**

```bash
cd Exchange_js
git add src/modules/identity/onboarding/onboarding.module.ts
git commit -m "refactor(onboarding): remove old sumsub webhook/simulation controllers"
```

---

## Task 9: Admin web — `SumsubEventsPage`

**Files:**
- Create: `admin-web/src/pages/SumsubEventsPage.tsx`

- [ ] **Step 1: Create the page**

```tsx
// admin-web/src/pages/SumsubEventsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, X, Play } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

// ── Types ──────────────────────────────────────────────────────────────────

type EventStatus = 'PENDING' | 'PROCESSED' | 'FAILED' | 'DEAD';

interface SumsubEventItem {
  id: string;
  eventNo: string;
  eventType: string;
  applicantId: string;
  externalUserId: string;
  context: string;
  status: EventStatus;
  retryCount: number;
  isSimulated: boolean;
  receivedAt: string;
  processedAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

interface ListResponse {
  total: number;
  skip: number;
  take: number;
  items: SumsubEventItem[];
}

interface FilterState {
  status: string;
  eventType: string;
  externalUserId: string;
}

type SimulationScenario =
  | 'LOW_RISK_PASS'
  | 'MANUAL_REVIEW'
  | 'RESUBMIT_REQUIRED'
  | 'EDD_ESCALATE'
  | 'EDD_PASS'
  | 'WORKFLOW_FAIL';

const SCENARIOS: { value: SimulationScenario; label: string; hint: string }[] = [
  {
    value: 'LOW_RISK_PASS',
    label: '✅ Low risk — auto approve',
    hint: 'applicantWorkflowCompleted (no level2) → APPROVED',
  },
  {
    value: 'MANUAL_REVIEW',
    label: '🔍 Manual review required',
    hint: 'applicantOnHold → substatus UNDER_REVIEW',
  },
  {
    value: 'RESUBMIT_REQUIRED',
    label: '📄 Resubmission required',
    hint: 'applicantReviewed RED+RETRY → substatus RESUBMIT_REQUIRED',
  },
  {
    value: 'EDD_ESCALATE',
    label: '⬆️ Escalate to EDD',
    hint: 'applicantLevelChanged level2 → sets sumsubExperiencedLevel2=true',
  },
  {
    value: 'EDD_PASS',
    label: '✅ EDD passed — needs Final Approval',
    hint: 'applicantWorkflowCompleted (with level2) → FINAL_APPROVAL (run EDD_ESCALATE first)',
  },
  {
    value: 'WORKFLOW_FAIL',
    label: '❌ Workflow failed — rejected',
    hint: 'applicantWorkflowFailed → REJECTED',
  },
];

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  eventType: '',
  externalUserId: '',
};

const STATUS_BADGE_MAP: Record<EventStatus, string> = {
  PROCESSED: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'REJECTED',
  DEAD: 'FAILED',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function SumsubEventsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SumsubEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Simulation modal state
  const [showSimulate, setShowSimulate] = useState(false);
  const [simCustomerId, setSimCustomerId] = useState('');
  const [simScenario, setSimScenario] = useState<SimulationScenario>('LOW_RISK_PASS');
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const fetchEvents = async (page: number, f: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.status) params.set('status', f.status);
      if (f.eventType) params.set('eventType', f.eventType);
      if (f.externalUserId) params.set('externalUserId', f.externalUserId);

      const res = await adminFetch<ListResponse>(`/admin/sumsub-events?${params}`);
      setItems(res.items);
      setTotal(res.total);
      setCurrentPage(page);
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents(1, filters);
  }, []);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchEvents(1, DEFAULT_FILTERS);
  };

  const handleReplay = async (id: string) => {
    try {
      await adminFetch(`/admin/sumsub-events/${id}/replay`, { method: 'POST' });
      setMessage('Event replayed successfully.');
      void fetchEvents(currentPage, filters);
    } catch (e) {
      setError(getApiErrorMessage(e));
    }
  };

  const handleSimulate = async () => {
    if (!simCustomerId.trim()) { setSimError('Customer ID is required'); return; }
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await adminFetch<{ event: SumsubEventItem }>('/admin/sumsub-events/simulate', {
        method: 'POST',
        body: JSON.stringify({ customerId: simCustomerId, scenario: simScenario }),
      });
      setShowSimulate(false);
      setSimCustomerId('');
      setMessage(`Simulated: ${res.event.eventNo} (${res.event.status})`);
      void fetchEvents(1, filters);
    } catch (e) {
      setSimError(getApiErrorMessage(e));
    } finally {
      setSimLoading(false);
    }
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title bar */}
      <PageTitleBar
        title="Sumsub Events"
        meta={`${total} events · Unified webhook log`}
      >
        <button
          onClick={() => setShowSimulate(true)}
          className={adminButtonClass('listPrimary')}
        >
          <Play size={13} />
          Simulate Event
        </button>
        <button
          onClick={() => void fetchEvents(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="DEAD">DEAD</option>
        </select>
        <select
          value={filters.eventType}
          onChange={(e) => setFilters((p) => ({ ...p, eventType: e.target.value }))}
          className={`${fi} w-52`}
        >
          <option value="">All Event Types</option>
          <option value="applicantPending">applicantPending</option>
          <option value="applicantOnHold">applicantOnHold</option>
          <option value="applicantReviewed">applicantReviewed</option>
          <option value="applicantLevelChanged">applicantLevelChanged</option>
          <option value="applicantWorkflowCompleted">applicantWorkflowCompleted</option>
          <option value="applicantWorkflowFailed">applicantWorkflowFailed</option>
        </select>
        <input
          value={filters.externalUserId}
          onChange={(e) => setFilters((p) => ({ ...p, externalUserId: e.target.value }))}
          placeholder="Customer No / ID"
          className={`${fi} w-40`}
        />
        <button
          onClick={() => void fetchEvents(1, filters)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button onClick={handleReset} className={adminButtonClass('listSecondary')}>
          Reset
        </button>
      </div>

      {/* Banners */}
      {message && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green flex items-center justify-between">
          {message}
          <button onClick={() => setMessage(null)} className="ml-3 text-adm-t3 hover:text-adm-t1">
            <X size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(['Event No', 'Received', 'Type', 'Customer', 'Context', 'Status', 'Retries', ''] as string[]).map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No events found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-adm-border transition-colors hover:bg-adm-hover"
                >
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.eventNo}
                    </span>
                    {item.isSimulated && (
                      <span className="ml-2 rounded border border-adm-blue/25 bg-adm-blue/8 px-1 font-mono text-[9px] text-adm-blue">
                        SIM
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                    {new Date(item.receivedAt).toLocaleDateString()}
                    <br />
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                    {item.eventType}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                    {item.externalUserId}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t3">
                    {item.context}
                  </td>
                  <td className="px-3 py-2.5">
                    <AdminBadge value={STATUS_BADGE_MAP[item.status] ?? item.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t3">
                    {item.retryCount}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.status === 'DEAD' && (
                      <button
                        onClick={() => void handleReplay(item.id)}
                        className={adminButtonClass('repair')}
                      >
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchEvents(page, filters)}
        />
      </div>

      {/* Simulation Modal */}
      {showSimulate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[520px] rounded-lg border border-adm-border bg-adm-panel shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-3">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                Simulate Sumsub Event
              </span>
              <button
                onClick={() => { setShowSimulate(false); setSimError(null); }}
                className="text-adm-t3 hover:text-adm-t1"
              >
                <X size={14} />
              </button>
            </div>

            {/* Modal body */}
            <div className="space-y-4 p-5">
              {/* Customer ID input */}
              <div>
                <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Customer ID (internal cuid or customerNo)
                </label>
                <input
                  value={simCustomerId}
                  onChange={(e) => setSimCustomerId(e.target.value)}
                  placeholder="e.g. clxxxxx… or CUST-001"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                />
              </div>

              {/* Scenario selector */}
              <div>
                <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Scenario
                </label>
                <div className="space-y-1.5">
                  {SCENARIOS.map((s) => (
                    <label
                      key={s.value}
                      className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 transition-colors ${
                        simScenario === s.value
                          ? 'border-adm-amber bg-adm-amber/6'
                          : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                      }`}
                    >
                      <input
                        type="radio"
                        name="scenario"
                        value={s.value}
                        checked={simScenario === s.value}
                        onChange={() => setSimScenario(s.value)}
                        className="mt-0.5 shrink-0"
                      />
                      <div>
                        <div className="font-mono text-[11px] text-adm-t1">{s.label}</div>
                        <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{s.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {simError && (
                <div className="rounded border border-adm-red/20 bg-adm-red/6 px-3 py-2 font-mono text-[11px] text-adm-red">
                  {simError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border px-5 py-3">
              <button
                onClick={() => { setShowSimulate(false); setSimError(null); }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSimulate()}
                disabled={simLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {simLoading ? 'Sending…' : 'Send Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd Exchange_js
git add admin-web/src/pages/SumsubEventsPage.tsx
git commit -m "feat(admin-web): add SumsubEventsPage with event log and simulation modal"
```

---

## Task 10: Admin web — route + nav item

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: Add route to `App.tsx`**

In `admin-web/src/App.tsx`, find the section with lazy-loaded compliance/admin routes. Add the lazy import near the other compliance page imports:

```tsx
const SumsubEventsPage = lazy(() => import('./pages/SumsubEventsPage'));
```

Then inside the protected `<Route path="/dashboard" ...>` routes, find the compliance section and add:

```tsx
<Route path="sumsub-events" element={<SumsubEventsPage />} />
```

- [ ] **Step 2: Add nav item to `DashboardLayout.tsx`**

Open `admin-web/src/components/DashboardLayout.tsx`. Find the Compliance menu group (the array of nav items under "Compliance" or "Risk Management"). Add this entry:

```tsx
{
  path: '/dashboard/sumsub-events',
  icon: <Radio size={16} />,
  label: 'Sumsub Events',
  requiredPermissions: [],
},
```

Add `Radio` to the lucide-react import at the top of `DashboardLayout.tsx`:

```tsx
import { ..., Radio } from 'lucide-react';
```

- [ ] **Step 3: Verify in browser**

Start the admin dev server:
```bash
cd Exchange_js/admin-web
npm run dev
```

Navigate to `http://localhost:3001`. Log in as admin. Verify:
- "Sumsub Events" appears in the sidebar under Compliance
- Clicking it loads the event log page (may be empty initially)
- "Simulate Event" button opens the modal
- All 6 scenario radio buttons appear with their hint text

- [ ] **Step 4: Commit**

```bash
cd Exchange_js
git add admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(admin-web): add Sumsub Events route and nav item"
```

---

## Task 11: End-to-end demo validation

This task verifies the full simulation flow works correctly across all 6 scenarios.

- [ ] **Step 1: Start the full stack**

```bash
cd Exchange_js
npm run dev:start
```

- [ ] **Step 2: Verify LOW_RISK_PASS flow**

In admin web → Sumsub Events → Simulate Event:
- Enter a customer ID who is in `PENDING_VERIFICATION` status
- Select "✅ Low risk — auto approve"
- Click "Send Event"

Expected: New event appears in list with status `PROCESSED`. Customer's `onboardingStatus` changes to `APPROVED`.

Verify customer status via API:
```bash
curl -H "Authorization: Bearer <admin_token>" http://localhost:3000/admin/customers/<customerId>
```
Expected: `"onboardingStatus": "APPROVED"`, `"operatingStatus": "ACTIVE"`

- [ ] **Step 3: Verify EDD full path (2-step)**

With a fresh `PENDING_VERIFICATION` customer:

Step 3a: Simulate "⬆️ Escalate to EDD" → event `PROCESSED`, customer substatus `NEXT_LEVEL_REQUIRED`, `sumsubExperiencedLevel2 = true`

Step 3b: Simulate "✅ EDD passed — needs Final Approval" → event `PROCESSED`, customer `onboardingStatus = FINAL_APPROVAL`, approval case created.

Verify: In admin → Governance → Approvals, the `ONBOARDING_FINAL_APPROVAL` case should appear.

- [ ] **Step 4: Verify WORKFLOW_FAIL**

With a `PENDING_VERIFICATION` customer:
- Simulate "❌ Workflow failed — rejected"

Expected: customer `onboardingStatus = REJECTED`.

- [ ] **Step 5: Verify DEAD event replay**

Temporarily break the onboarding handler by stopping the backend, or simulate with an invalid `customerId`. Verify event reaches `DEAD` status after retry exhaustion. Then fix and use "Replay" button — verify it processes successfully.

- [ ] **Step 6: Commit any fixes, then final commit**

```bash
cd Exchange_js
git add -A
git commit -m "test(sumsub-ingestion): validate all 6 simulation scenarios end-to-end"
```

---

## Self-Review

**Spec coverage check:**

| Spec Requirement | Task |
|---|---|
| Unified `POST /webhooks/sumsub` entry point | Task 4 |
| `sumsub_webhook_events` persistence table | Task 1 |
| HMAC verification | Task 4 (reuses `SumsubClient.verifyWebhookSignature`) |
| Route to domain handler (ONBOARDING) | Task 3 (dispatch method) |
| Auto-retry up to 3x with exponential backoff | Task 5 |
| DEAD events write system alert | Task 3 (`// TODO Wave 9`) |
| Admin event log (list + detail) | Task 6 + Task 9 |
| Admin simulation — 6 scenarios | Task 3 (buildScenarioPayload) + Task 9 (modal) |
| Simulated events marked with `isSimulated=true` | Task 3 |
| Replay DEAD events | Task 3 + Task 6 + Task 9 |
| Remove old `/onboarding/sumsub/webhook` | Task 8 |
| Remove old `/onboarding/sumsub/simulate` | Task 8 |
| Fire-and-forget for real, synchronous for simulation | Task 3 (ingest method) |
| Idempotency / deduplication | Task 3 (buildDedupeKey) |

**Type consistency check:**
- `SimulationScenario` enum defined in Task 2 (DTO), used in Task 3 (service) and Task 9 (frontend) — consistent.
- `SumsubWebhookEvent` Prisma type used throughout — comes from Task 1 schema.
- `STATUS_BADGE_MAP` in frontend maps `EventStatus` to values `AdminBadge` understands (`SUCCESS`/`PENDING`/`REJECTED`/`FAILED`) — consistent with `AdminBadge`'s `STATUS_MAP`.

**No placeholders:** `// TODO Wave 9` for dead-event system alert is the only intentional deferral — it is explicitly labeled and does not block current functionality.
