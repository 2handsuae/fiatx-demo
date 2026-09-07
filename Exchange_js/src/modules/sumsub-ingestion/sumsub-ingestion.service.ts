// src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
import { MaterialRequestReviewService } from '../identity/material-requests/material-request-review.service';
import { OnboardingWorkflowService } from '../identity/onboarding/onboarding-workflow.service';
import { TierUpgradeWorkflowService } from '../identity/tier-upgrade/tier-upgrade-workflow.service';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { DepositWebhookRouter } from '../deposit-sumsub/deposit-webhook.router';
import { WithdrawWebhookRouter } from '../withdraw-sumsub/withdraw-webhook.router';
import { SwapWebhookRouter } from '../swap-sumsub/swap-webhook.router';
import { KYT_VERDICT_TYPES } from '../sumsub-shared/kyt-webhook-types';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import { SumsubWebhookEvent } from '@prisma/client';

const MAX_NO_RETRIES = 5;
const MAX_DISPATCH_ATTEMPTS = 3; // event becomes DEAD after this many failed attempts

@Injectable()
export class SumsubIngestionService {
  private readonly logger = new Logger(SumsubIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depositWorkflowService: DepositWorkflowService,
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly depositWebhookRouter: DepositWebhookRouter,
    private readonly withdrawWebhookRouter: WithdrawWebhookRouter,
    private readonly swapWebhookRouter: SwapWebhookRouter,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
    private readonly materialRequestReviewService: MaterialRequestReviewService,
    private readonly onboardingWorkflow: OnboardingWorkflowService,
    private readonly tierUpgradeWorkflow: TierUpgradeWorkflowService,
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

      const inspectionId = String(payload.inspectionId ?? '');
      const applicantId = String(payload.applicantId ?? '');
      const externalActionId: string | undefined =
        (payload.externalActionId as string | undefined) ??
        (payload.applicantActionExternalId as string | undefined) ??
        undefined;
      const reviewResult = (payload.reviewResult ?? null) as {
        reviewAnswer: 'GREEN' | 'RED';
        rejectLabels?: string[];
        reviewRejectType?: string;
      } | null;

      // ── Pre-routing: deposit/withdraw Sumsub KYT-txn webhook types (Task 5/4) ──
      // Reuses this durable event table's dedup/retry/dead-letter; only the
      // routing target changes here. Old withdraw/swap/kyt/tr branches below are untouched.
      // NOTE: does NOT include applicantAction* — those are consumed by the
      // externalActionId 分支下方（材料请求账一次查表命中后收尾——材料刷新监控
      // 已随巡查退役（2026-09-06），事件落 unrouted 警告）。
      // deposit 侧对 action 事件的重检不需要专门 handler:客户补料后 Sumsub 会自动
      // 重评并发出 applicantKytTxn*,仍走上面这条 KYT 分支(Task 9 结论,
      // DepositActionHandler 桩已退役)。
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
      // 站6：caseDecisionSimulated（CRA 制裁升级案终裁模拟）随一期风评拆除。
      // ── applicantActionReviewed：按 externalActionId 一次查表定位归属 ──
      // 2026-08-17 材料请求账之前，这里是一条「先问 swap 认不认、不认再落材料重检」
      // 的顺序尝试链，且因为同属一条 else-if 链，一旦命中就把下面的
      // ongoingDocExpired / inspectionId 两条分支彻底遮蔽 —— 原注释自陈这是
      // 跨域收窄隐患。根因是没有统一 id 空间。现在 externalActionId 是
      // material_requests 的 @unique 列，一次查表就能定位，不用猜。
      else if (depositWebhookType === 'applicantActionReviewed' && externalActionId) {
        const reviewed = await this.materialRequestReviewService.applyReview({
          externalActionId,
          reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
          reviewRejectType:
            reviewResult?.reviewRejectType === 'RETRY' ? 'RETRY' : 'FINAL',
          actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
        });
        if (reviewed) {
          result = { routedTo: 'material-requests', ...reviewed };
          dispatchedContext = 'MATERIAL_REQUEST';
        }
      }
      // ── 波二开路：申请人级主流程（入驻）。放行顺序不变：KYT 级联与材料请求
      // 两路在前；这里只认两个申请人级事件类型，其余照旧落 unrouted warn。──
      else if (depositWebhookType === 'applicantLevelChanged' && applicantId) {
        const changed = await this.onboardingWorkflow.applyLevelChange({ applicantId });
        if (changed) {
          result = { routedTo: 'onboarding', ...changed };
          dispatchedContext = 'ONBOARDING';
        }
      }
      else if (depositWebhookType === 'applicantReviewed' && applicantId) {
        // 波三：先问升档线（按「在审升级申请单存在性」认领，spec §4）；null 落回入驻线。
        const upgraded = await this.tierUpgradeWorkflow.applyReviewVerdict({
          applicantId,
          reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
          reviewRejectType: reviewResult?.reviewRejectType === 'FINAL' ? 'FINAL' : 'RETRY',
        });
        if (upgraded) {
          result = { routedTo: 'tier-upgrade', ...upgraded };
          dispatchedContext = 'TIER_UPGRADE';
        } else {
          const verdict = await this.onboardingWorkflow.applyReviewVerdict({
            applicantId,
            reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
            reviewRejectType: reviewResult?.reviewRejectType === 'FINAL' ? 'FINAL' : 'RETRY',
          });
          if (verdict) { result = { routedTo: 'onboarding', ...verdict }; dispatchedContext = 'ONBOARDING'; }
        }
      }
      // Clue 1（ongoingDocExpired）：材料刷新监控已随巡查退役（2026-09-06），
      // 事件落 unrouted 警告。
      // 站6：Clue 2（AML 按 inspectionId 归属 CRA）随一期风评拆除。
      // Clue 3（已退役，2026-08-18）：原来按 actionId 查 pending MaterialRefreshCycle。
      // 2026-08-17 材料请求账 Task 11 之后建 cycle 全部改走
      // MaterialRequestIssuerService.issue()，cycle 定位其旧的 Sumsub action id
      // 那一列永远不再被写入（该列已随 Task 12 物理删除），这条分支对所有新周期
      // 恒查不到，是死码；而且真实
      // webhook 也轮不到它——上面 `applicantActionReviewed && externalActionId`
      // 那条分支会先按 externalActionId 认领。已改为材料重检域自己监听
      // MaterialRequestReviewService 广播的 MATERIAL_REQUEST_REVIEWED 事件——
      // 材料刷新监控已随巡查退役（2026-09-06），事件落 unrouted 警告，不再需要
      // 这里的兜底查询。
      // Clues 4 & 5: look up customer by applicantId
      if (!result && applicantId) {
        const customer = await this.prisma.customerMain.findFirst({
          where: { sumsubApplicantId: applicantId },
        });
        if (customer) {
          // 站6：Clue 4（入驻验证）/4.5（升级案 Level2）/5（自发 AML 红）随一期
          // 拆除（业主方案2）——申请人级主流程已于波二开路（onboarding 分支）；
          // 仍未命中的事件落此警告。
          this.logger.warn('unrouted_sumsub_webhook', {
            applicantId,
            type: event.eventType,
            customerStatus: customer.lifecycle,
          });
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

  // 站6：scenario 式模拟（simulate/buildScenarioPayload——全部一期入驻场景）随一期拆除；
  // 二期各域模拟走各自 demo 模块与 admin/sumsub/simulate 面板的存活端点。


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

  // findOne()/replay() retired (Task 4) — both were only reachable via the admin
  // controller's :id detail GET and :id/replay POST, which had zero admin-web
  // consumers (the Sumsub Events page only ever listed events). Removed together.

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
    // 第一批 (2026-08-19)：KYT 交易裁决报文不带 reviewId/attemptId，于是同一客户的
    // 第二条同类型裁决键与第一条逐字相同 → 命中旧 PROCESSED 行直接 return，新裁决
    // 不落行、不派发。模拟入口跳过去重所以演示不复现，接真 Sumsub 必中。
    // kytTxnId 只有 KYT 事件带，其它事件为空串 —— 对既有行为无影响。
    const kytTxnId = String(payload.kytTxnId ?? '');
    if (!type || !applicantId) return null;
    return `${type}:${applicantId}:${externalUserId}:${reviewId}:${attemptId}:${kytTxnId}`;
  }

  private extractDedupeKey(payload: Record<string, unknown>): string | null {
    return this.buildDedupeKey(payload);
  }

  private async refresh(id: string): Promise<SumsubWebhookEvent> {
    return this.prisma.sumsubWebhookEvent.findUniqueOrThrow({ where: { id } });
  }
}
