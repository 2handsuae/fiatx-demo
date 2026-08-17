import { SumsubIngestionService } from './sumsub-ingestion.service';
import { DepositWebhookRouter } from '../deposit-sumsub/deposit-webhook.router';
import { WithdrawWebhookRouter } from '../withdraw-sumsub/withdraw-webhook.router';
import { SwapWebhookRouter } from '../swap-sumsub/swap-webhook.router';
import { SumsubWebhookEvent } from '@prisma/client';

/**
 * Task 4/5: focused unit test for the deposit → withdraw → swap cascade added
 * to dispatch(). No prior sumsub-ingestion.service.spec.ts existed — this file is
 * new, scoped to the cascade only (everything else in dispatch() — clue 1-5,
 * simulation event types — is exercised elsewhere/e2e, untouched by this task).
 * Constructs the service directly with hand-rolled mocks (same lightweight style
 * as deposit-kyt-verdict.handler.spec.ts) rather than booting the full Nest DI
 * graph — dispatch()'s KYT-verdict branch only touches prisma.sumsubWebhookEvent
 * and the three routers.
 */
describe('SumsubIngestionService — deposit/withdraw/swap KYT cascade (Task 4/5)', () => {
  let prisma: any;
  let depositWebhookRouter: jest.Mocked<DepositWebhookRouter>;
  let withdrawWebhookRouter: jest.Mocked<WithdrawWebhookRouter>;
  let swapWebhookRouter: jest.Mocked<SwapWebhookRouter>;
  // Finding 6（终审 Minor）：给 Clue 3（材料重检）配一个真 mock，而不是空
  // `{} as any` —— 否则"swap miss 应该继续往下落到 Clue 3"这句断言无从谈起。
  let materialRefreshService: any;
  // Task 4（材料请求账）：applicantActionReviewed 现在直接查材料请求账，
  // 不再问 swap router — mock 掉 MaterialRequestReviewService.applyReview。
  let materialRequestReviewService: any;
  let service: SumsubIngestionService;

  function buildEvent(type: string, kytTxnId = 'T1'): SumsubWebhookEvent {
    return {
      id: 'evt-1',
      eventNo: 'SWH-1',
      eventType: type,
      applicantId: 'app-1',
      externalUserId: '',
      context: 'ONBOARDING',
      rawPayload: JSON.stringify({ type, kytTxnId }),
      receivedAt: new Date(),
      status: 'PENDING',
      retryCount: 0,
      lastRetryAt: null,
      lastErrorMessage: null,
      processedAt: null,
      dispatchedTo: null,
      isSimulated: false,
      simulatedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as SumsubWebhookEvent;
  }

  beforeEach(() => {
    prisma = {
      sumsubWebhookEvent: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      // Finding 6: only touched by the "swap miss → falls through to Clue 3"
      // test below; harmless no-op for every other test in this file.
      materialRefreshCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    depositWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<DepositWebhookRouter>;
    withdrawWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<WithdrawWebhookRouter>;
    swapWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<SwapWebhookRouter>;
    materialRefreshService = { handleSumsubActionResult: jest.fn().mockResolvedValue(undefined) };
    materialRequestReviewService = { applyReview: jest.fn().mockResolvedValue(null) };

    service = new SumsubIngestionService(
      prisma,
      {} as any, // onboardingService
      {} as any, // clientRiskAssessmentService
      materialRefreshService,
      {} as any, // tierUpgradeCaseService
      {} as any, // depositWorkflowService
      {} as any, // withdrawService
      depositWebhookRouter,
      withdrawWebhookRouter,
      swapWebhookRouter,
      // Task 7：caseDecisionSimulated 的 APPROVE/REJECT 改走限制账
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }) } as any,
      { autoRelease: jest.fn().mockResolvedValue(undefined) } as any,
      materialRequestReviewService,
    );
  });

  it('deposit hit (route()=true) → withdraw + swap routers NOT called', async () => {
    depositWebhookRouter.route.mockResolvedValue(true);
    const event = buildEvent('applicantKytTxnApproved');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).not.toHaveBeenCalled();
    expect(swapWebhookRouter.route).not.toHaveBeenCalled();
    expect(result).toEqual({ routedTo: 'deposit-sumsub', type: 'applicantKytTxnApproved' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'DEPOSIT_SUMSUB' }) }),
    );
  });

  it('deposit miss, withdraw hit (route()=true) → swap router NOT called', async () => {
    depositWebhookRouter.route.mockResolvedValue(false);
    withdrawWebhookRouter.route.mockResolvedValue(true);
    const event = buildEvent('applicantKytTxnApproved');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' }),
    );
    expect(swapWebhookRouter.route).not.toHaveBeenCalled();
    expect(result).toEqual({ routedTo: 'withdraw-sumsub', type: 'applicantKytTxnApproved' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'WITHDRAW_SUMSUB' }) }),
    );
  });

  it('deposit + withdraw miss, swap hit (route()=true) → dispatchedTo=SWAP_SUMSUB (Task 5)', async () => {
    depositWebhookRouter.route.mockResolvedValue(false);
    withdrawWebhookRouter.route.mockResolvedValue(false);
    swapWebhookRouter.route.mockResolvedValue(true);
    const event = buildEvent('applicantKytTxnApproved');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(swapWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(swapWebhookRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' }),
    );
    expect(result).toEqual({ routedTo: 'swap-sumsub', type: 'applicantKytTxnApproved' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'SWAP_SUMSUB' }) }),
    );
  });

  it('deposit + withdraw + swap all miss (true orphan) → dispatchedTo=SUMSUB_KYT_ORPHAN, still marks PROCESSED', async () => {
    depositWebhookRouter.route.mockResolvedValue(false);
    withdrawWebhookRouter.route.mockResolvedValue(false);
    swapWebhookRouter.route.mockResolvedValue(false);
    const event = buildEvent('applicantKytOnHold', 'UNKNOWN');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(swapWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ routedTo: 'orphan', type: 'applicantKytOnHold' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PROCESSED',
          dispatchedTo: 'SUMSUB_KYT_ORPHAN',
        }),
      }),
    );
  });

  // ── Task 4（材料请求账）: applicantActionReviewed → 按 externalActionId 一次查表 ──
  // 2026-08-17 之前这里是"先问 swap router 认不认、不认再落 Clue 3（材料重检）"
  // 的顺序尝试链；本任务把它换成一次 MaterialRequestReviewService.applyReview()
  // 查表，swapWebhookRouter 完全不再被这个事件类型触碰（它仍被上面的
  // KYT_VERDICT_TYPES 级联使用，那部分不受影响）。

  // 真实 applicantActionReviewed webhook 同时带 externalActionId（本账
  // @unique 键）和 Sumsub 自己的 actionId（material-refresh 域的键，走 Clue 3）。
  // 只有"不属于本账"的用例会传 actionId，用来证明 Clue 3 依然可达。
  function buildActionEvent(externalActionId = 'EA1', actionId?: string): SumsubWebhookEvent {
    return {
      id: 'evt-2',
      eventNo: 'SWH-2',
      eventType: 'applicantActionReviewed',
      applicantId: 'app-1',
      externalUserId: '',
      context: 'ONBOARDING',
      rawPayload: JSON.stringify({
        type: 'applicantActionReviewed',
        externalActionId,
        ...(actionId ? { actionId } : {}),
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      receivedAt: new Date(),
      status: 'PENDING',
      retryCount: 0,
      lastRetryAt: null,
      lastErrorMessage: null,
      processedAt: null,
      dispatchedTo: null,
      isSimulated: false,
      simulatedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as SumsubWebhookEvent;
  }

  it('applicantActionReviewed, externalActionId 属于本账 → 只查 materialRequestReviewService（deposit/withdraw/swap router 都不碰），dispatchedTo=MATERIAL_REQUEST', async () => {
    materialRequestReviewService.applyReview.mockResolvedValue({ requestNo: 'MRQ1', outcome: 'APPROVED' });
    const event = buildActionEvent('EA1');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).not.toHaveBeenCalled();
    expect(withdrawWebhookRouter.route).not.toHaveBeenCalled();
    expect(swapWebhookRouter.route).not.toHaveBeenCalled();
    expect(materialRequestReviewService.applyReview).toHaveBeenCalledWith({
      externalActionId: 'EA1',
      reviewAnswer: 'GREEN',
      reviewRejectType: 'FINAL',
      actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
    });
    expect(result).toEqual({ routedTo: 'material-requests', requestNo: 'MRQ1', outcome: 'APPROVED' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'MATERIAL_REQUEST' }) }),
    );
  });

  it('applicantActionReviewed, externalActionId 不属于本账（applyReview 返回 null）→ 不被认领，后续分支（Clue 3 材料重检）照常可达', async () => {
    // 这条锁的是本任务改动前"swap miss 时 Clue 3 仍会触发"用例锁的同一条属性，
    // 只是认领方从 swapWebhookRouter 换成了 materialRequestReviewService：
    // 一个不属于本账的 externalActionId 必须静默放行，不能把 Clue 3 挡住。
    materialRequestReviewService.applyReview.mockResolvedValue(null);
    const event = buildActionEvent('some-other-domain-action-id', 'SUMSUB-ACTION-1');
    prisma.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      sumsubActionId: 'SUMSUB-ACTION-1',
      status: 'PENDING_SUMSUB_REVIEW',
    });

    const result = await service.dispatch(event);

    expect(materialRequestReviewService.applyReview).toHaveBeenCalledWith({
      externalActionId: 'some-other-domain-action-id',
      reviewAnswer: 'GREEN',
      reviewRejectType: 'FINAL',
      actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
    });
    expect(prisma.materialRefreshCycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sumsubActionId: 'SUMSUB-ACTION-1' }),
      }),
    );
    expect(materialRefreshService.handleSumsubActionResult).toHaveBeenCalledWith({
      actionId: 'SUMSUB-ACTION-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });
    // handleSumsubActionResult itself returns void — this is not a regression,
    // just what Clue 3's own return type is.
    expect(result).toBeUndefined();
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED', dispatchedTo: 'MATERIAL_REFRESH_ACTION' }),
      }),
    );
  });
});
