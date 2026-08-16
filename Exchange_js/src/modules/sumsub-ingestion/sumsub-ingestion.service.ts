// src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
import { OnboardingService } from '../identity/onboarding/onboarding.service';
import { ClientRiskAssessmentService } from '../identity/client-risk-assessment/client-risk-assessment.service';
import { MaterialRefreshService } from '../identity/material-refresh/material-refresh.service';
import { TierUpgradeCaseService } from '../identity/tier-upgrade-case/tier-upgrade-case.service';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { DepositWebhookRouter } from '../deposit-sumsub/deposit-webhook.router';
import { WithdrawWebhookRouter } from '../withdraw-sumsub/withdraw-webhook.router';
import { SwapWebhookRouter } from '../swap-sumsub/swap-webhook.router';
import { KYT_VERDICT_TYPES } from '../deposit-sumsub/kyt-webhook-types';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import { SimulationScenario } from './dto/sumsub-ingestion.dto';
import { SumsubWebhookEvent } from '@prisma/client';

const MAX_NO_RETRIES = 5;
const MAX_DISPATCH_ATTEMPTS = 3; // event becomes DEAD after this many failed attempts

@Injectable()
export class SumsubIngestionService {
  private readonly logger = new Logger(SumsubIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
    private readonly depositWorkflowService: DepositWorkflowService,
    @Inject(forwardRef(() => WithdrawTransactionsService))
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly depositWebhookRouter: DepositWebhookRouter,
    private readonly withdrawWebhookRouter: WithdrawWebhookRouter,
    private readonly swapWebhookRouter: SwapWebhookRouter,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
  ) {}

  // ─── Main entry point (real webhook + simulation both call this) ──────────

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

  // ─── Dispatch to domain handler ───────────────────────────────────────────

  async dispatch(event: SumsubWebhookEvent): Promise<unknown> {
    try {
      // rawPayload is stored as a JSON string in SQLite; parse it back to an object
      const payload = this.parseRawPayload(event.rawPayload);
      let result: unknown;
      let dispatchedContext = event.context;

      const reviewMode = String(payload.reviewMode ?? '');
      const inspectionId = String(payload.inspectionId ?? '');
      const actionId = String(payload.actionId ?? '');
      const applicantId = String(payload.applicantId ?? '');
      const reviewResult = (payload.reviewResult ?? null) as {
        reviewAnswer: 'GREEN' | 'RED';
        rejectLabels?: string[];
        reviewRejectType?: string;
      } | null;

      // ── Pre-routing: deposit/withdraw Sumsub KYT-txn webhook types (Task 5/4) ──
      // Reuses this durable event table's dedup/retry/dead-letter; only the
      // routing target changes here. Old withdraw/swap/kyt/tr branches below are untouched.
      // NOTE: does NOT include applicantAction* — those are consumed by the
      // pre-existing Clue 3 branch below (material-refresh cycles). deposit 侧对
      // action 事件的重检不需要专门 handler:客户补料后 Sumsub 会自动重评并发出
      // applicantKytTxn*,仍走上面这条 KYT 分支(Task 9 结论,DepositActionHandler 桩已退役)。
      const depositWebhookType = String(payload.type ?? '');
      // 显式集合匹配,不用 startsWith:官方 on-hold 事件是 `applicantKytOnHold`(无 Txn),
      // 旧的 `startsWith('applicantKytTxn')` 会把它漏在门外;而放宽成 `applicantKyt`
      // 又会误吞 AML 等同前缀的其它族事件。见 kyt-webhook-types.ts。
      if (KYT_VERDICT_TYPES.has(depositWebhookType)) {
        // Task 4/5: cascade — deposit tried first (owns the vast majority of
        // KYT-txn webhooks); only when it reports no ownership (hit=false)
        // does the same payload fall through to withdraw-sumsub, then to
        // swap-sumsub (Task 5, last stage) if withdraw also misses. All three
        // domains key off the same kytTxnId, so at most one of them ever owns
        // a given event.
        const depositHit = await this.depositWebhookRouter.route(payload);
        let withdrawHit = false;
        let swapHit = false;
        if (!depositHit) {
          withdrawHit = await this.withdrawWebhookRouter.route(payload);
          if (!withdrawHit) {
            swapHit = await this.swapWebhookRouter.route(payload);
          }
        }
        const routedTo = depositHit
          ? 'deposit-sumsub'
          : withdrawHit
          ? 'withdraw-sumsub'
          : swapHit
          ? 'swap-sumsub'
          : 'orphan';
        result = { routedTo, type: depositWebhookType };
        dispatchedContext = depositHit
          ? 'DEPOSIT_SUMSUB'
          : withdrawHit
          ? 'WITHDRAW_SUMSUB'
          : swapHit
          ? 'SWAP_SUMSUB'
          : 'SUMSUB_KYT_ORPHAN';
      }
      // ── Synthetic simulation event types (exact eventType match, highest priority) ──
      // withdrawKytCheckSimulated/withdrawTravelRuleCheckSimulated retired with the old
      // preKyt/travelRule mock pipeline (Task 5 — real Sumsub single-txn submit +
      // applyKytVerdict replaces it; see WithdrawWorkflowService).
      else if (event.eventType === 'caseDecisionSimulated') {
        const assessmentId = String(payload.assessmentId ?? '');
        const customerId = String(payload.customerId ?? '');
        const decision = String(payload.decision ?? '');
        const assessment = await this.prisma.clientRiskAssessment.findUnique({ where: { id: assessmentId } });
        if (!assessment || assessment.status !== 'ESCALATED_TO_SUMSUB') {
          throw new Error(`Assessment ${assessmentId} is not in ESCALATED_TO_SUMSUB status`);
        }
        if (decision === 'APPROVE') {
          // 自动撕：cause + caseRef 双键，只撕 CRA 制裁路径用同一 assessmentId
          // 贴的那张 SANCTION。客户身上材料/升级等别的便签一概不动。
          await this.restrictionWorkflowService.autoRelease(
            customerId,
            'SANCTION',
            assessmentId,
            'system',
          );
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
          // INV-1：Sumsub MLRO 判拒 ≠ lifecycle 回退成 REJECTED（原来还顺手把
          // 行政轴写成 INACTIVE、合规轴写成 FROZEN，三件事糊成一件）。
          // lifecycle 不动，摁住走便签。CRA 制裁路径已用同一 caseRef 贴过一张，
          // open() 幂等 → 这里 created:false，不会贴出第二张。
          await this.restrictionsService.open({
            customerId,
            cause: 'SANCTION',
            reason: `Sumsub MLRO case decision REJECT on assessment ${assessmentId}`,
            caseRef: assessmentId,
            openedBy: 'SYSTEM',
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
      // ── Task 13: swap-domain applicantActionReviewed (person-level action review) ──
      // Not a KYT-txn verdict — deliberately excluded from KYT_VERDICT_TYPES (see
      // that file's comment) — so it never enters the cascade above. swap-sumsub
      // owns action ids it itself exposed via CustomerMain.pendingActionExternalId
      // (Task 7's handleRejectDisposition); try it before falling through to the
      // pre-existing MaterialRefreshCycle actionId match below (Clue 3), which owns
      // a different id space (Sumsub's own sumsubActionId). swapWebhookRouter.route()
      // returns false when this externalActionId isn't one it recognises (belongs to
      // another domain, e.g. material refresh), letting dispatch fall through to
      // Clue 3 with the same payload exactly as before this task.
      else if (depositWebhookType === 'applicantActionReviewed') {
        // Finding 5（终审 Minor）：这条分支是 if/else-if 链的一环——一旦
        // `payload.type === 'applicantActionReviewed'` 命中这里，不管
        // `swapHit` 是 true 还是 false，本次 dispatch 都不会再落到下面的
        // Clue 1（`reviewMode === 'ongoingDocExpired'`）或 Clue 2
        // （`inspectionId` 匹配 PENDING_SUMSUB_RESULT 的 ClientRiskAssessment）
        // ——这两条分支同属一条 else-if 链，互斥。真实 Sumsub 的
        // applicantActionReviewed webhook 确实可能带 `inspectionId`（Clue 2
        // 之前是可达的），故这是一次跨域收窄。判断这是有意为之：
        // applicantActionReviewed 语义上是"人级补料动作复核"，Clue 1/2
        // 服务的是不同的域（文档时效重检 / AML 案件结果），把它们混进来会让
        // 这个人级事件被误判成别的域的信号。Clue 3（下面独立的
        // `if (!result && actionId && reviewResult)`，材料重检的
        // sumsubActionId 匹配）不受影响——它不在这条 else-if 链里，swap 认领
        // 不到（`swapHit=false`）时仍会正常落到 Clue 3。这条收窄已由
        // sumsub-ingestion.service.spec.ts 的 "swap miss" 用例锁定（断言
        // Clue 3 真的还会触发，而不只是 result 落空）。
        const swapHit = await this.swapWebhookRouter.route(payload);
        if (swapHit) {
          result = { routedTo: 'swap-sumsub', type: depositWebhookType };
          dispatchedContext = 'SWAP_SUMSUB';
        }
      }
      // Clue 1: explicit reviewMode → ongoing doc monitoring
      else if (reviewMode === 'ongoingDocExpired') {
        result = await this.materialRefreshService.handleSumsubDocMonitoringFire({ applicantId });
        dispatchedContext = 'MATERIAL_REFRESH_MONITORING';
      }
      // Clue 2: inspectionId matches pending ClientRiskAssessment
      else if (inspectionId && reviewResult) {
        const pendingAssessment = await this.prisma.clientRiskAssessment.findFirst({
          where: { sumsubAmlCheckInspectionId: inspectionId, status: 'PENDING_SUMSUB_RESULT' },
        });
        if (pendingAssessment) {
          result = await this.clientRiskAssessmentService.handleSumsubAmlResult(inspectionId, reviewResult);
          dispatchedContext = 'AML_ASSESSMENT';
        }
      }
      // Clue 3: actionId matches pending MaterialRefreshCycle
      if (!result && actionId && reviewResult) {
        const pendingCycle = await this.prisma.materialRefreshCycle.findFirst({
          where: { sumsubActionId: actionId, status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] } },
        });
        if (pendingCycle) {
          result = await this.materialRefreshService.handleSumsubActionResult({ actionId, reviewResult });
          dispatchedContext = 'MATERIAL_REFRESH_ACTION';
        }
      }
      // Clues 4 & 5: look up customer by applicantId
      if (!result && applicantId) {
        const customer = await this.prisma.customerMain.findFirst({
          where: { sumsubApplicantId: applicantId },
        });
        if (customer) {
          // Clue 4: still in onboarding → delegate to onboarding service
          if (customer.lifecycle === 'IN_VERIFICATION') {
            result = await this.onboardingService.handleSumsubVerificationEvent(payload, {
              simulated: event.isSimulated,
              actorId: event.isSimulated
                ? (event.externalUserId || event.simulatedByUserId || 'ADMIN_SIM')
                : 'SUMSUB',
              simulatedByUserId: event.simulatedByUserId || null,
              rawBody: Buffer.from(JSON.stringify(payload)),
            });
            dispatchedContext = 'ONBOARDING';
          }
          // Clue 4.5: APPROVED + applicantWorkflowCompleted → Level 2 completed
          // handleLevel2WorkflowComplete is idempotent: it returns early if no PENDING_LEVEL2 case exists
          else if (
            customer.lifecycle === 'ACTIVE' &&
            event.eventType === 'applicantWorkflowCompleted'
          ) {
            await this.tierUpgradeCaseService.handleLevel2WorkflowComplete(customer.id);
            result = { handled: 'tier_upgrade_level2_complete' };
            dispatchedContext = 'TIER_UPGRADE';
          }
          // Clue 5: APPROVED + spontaneous AML RED → create assessment from known result (no extra API call)
          else if (
            customer.lifecycle === 'ACTIVE' &&
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
          } else {
            this.logger.warn('unrouted_sumsub_webhook', {
              applicantId,
              type: event.eventType,
              customerStatus: customer.lifecycle,
            });
          }
        } else {
          this.logger.warn('unrouted_webhook_no_customer', { applicantId });
        }
      } else if (!result) {
        this.logger.warn('unrouted_webhook_no_applicant_id', { eventType: event.eventType });
      }

      await this.prisma.sumsubWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          dispatchedTo: dispatchedContext,
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
        // TODO Wave 9: write system alert for dead events
      }

      throw err;
    }
  }

  // ─── Simulation: build payload for each scenario ─────────────────────────

  async simulate(
    customerId: string | undefined,
    scenario: SimulationScenario,
    simulatedByUserId: string,
    overrides?: Record<string, unknown>,
    customerNo?: string,
  ): Promise<{ event: SumsubWebhookEvent; dispatchResult?: unknown }> {
    let customer: { id: string; customerNo: string | null; sumsubApplicantId: string | null } | null = null;
    if (customerNo) {
      customer = await this.prisma.customerMain.findFirst({
        where: { customerNo },
        select: { id: true, customerNo: true, sumsubApplicantId: true },
      });
      if (!customer) throw new NotFoundException(`Customer with No ${customerNo} not found`);
    } else if (customerId) {
      customer = await this.prisma.customerMain.findUnique({
        where: { id: customerId },
        select: { id: true, customerNo: true, sumsubApplicantId: true },
      });
      if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);
    } else {
      throw new BadRequestException('Either customerId or customerNo is required');
    }

    // Only include applicantId if customer already has a real one.
    // Without it, the webhook handler falls through to externalUserId lookup.
    const applicantId = customer.sumsubApplicantId ?? null;
    const basePayload = this.buildScenarioPayload(scenario, applicantId, customer.id);
    const finalPayload = { ...basePayload, ...(overrides ?? {}) };

    return this.ingest(finalPayload, { isSimulated: true, simulatedByUserId });
  }

  private buildScenarioPayload(
    scenario: SimulationScenario,
    applicantId: string | null,
    externalUserId: string,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = { externalUserId };
    if (applicantId) base.applicantId = applicantId;
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
      ...(query.status ? { status: query.status as 'PENDING' | 'PROCESSED' | 'FAILED' | 'DEAD' } : {}),
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
    // Reset retryCount to 0: admin explicitly chose to replay this event.
    // The event can reach DEAD again if dispatch continues to fail.
    const reset = await this.prisma.sumsubWebhookEvent.update({
      where: { id },
      data: { status: 'FAILED', retryCount: 0, lastErrorMessage: null },
    });
    await this.dispatch(reset);
    return { event: await this.refresh(id) };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private parseRawPayload(rawPayload: string): Record<string, unknown> {
    if (typeof rawPayload !== 'string') {
      // Already an object (should not happen with SQLite String type, but guard anyway)
      return rawPayload as unknown as Record<string, unknown>;
    }
    try {
      return JSON.parse(rawPayload) as Record<string, unknown>;
    } catch (err) {
      this.logger.error(`Failed to parse rawPayload for event: ${String(err)}`);
      return {};
    }
  }

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

  private buildDedupeKey(payload: Record<string, unknown>): string | null {
    const type = String(payload.type ?? '');
    const applicantId = String(payload.applicantId ?? '');
    const externalUserId = String(payload.externalUserId ?? '');
    const reviewResult = payload.reviewResult as Record<string, unknown> | undefined;
    const reviewId = String(reviewResult?.reviewId ?? payload.reviewId ?? '');
    const attemptId = String(reviewResult?.attemptId ?? payload.attemptId ?? '');
    if (!type || !applicantId) return null;
    return `${type}:${applicantId}:${externalUserId}:${reviewId}:${attemptId}`;
  }

  private extractDedupeKey(payload: Record<string, unknown>): string | null {
    return this.buildDedupeKey(payload);
  }

  private async refresh(id: string): Promise<SumsubWebhookEvent> {
    return this.prisma.sumsubWebhookEvent.findUniqueOrThrow({ where: { id } });
  }
}
