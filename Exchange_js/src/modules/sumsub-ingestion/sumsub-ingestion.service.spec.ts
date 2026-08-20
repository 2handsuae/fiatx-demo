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
      // 2026-08-18：Clue 3（按 actionId 查 pending MaterialRefreshCycle）已随
      // 死码一起删除，dispatch() 不再触碰 prisma.materialRefreshCycle，此处不
      // 再需要那张桩表。
      customerMain: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    depositWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<DepositWebhookRouter>;
    withdrawWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<WithdrawWebhookRouter>;
    swapWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<SwapWebhookRouter>;
    materialRefreshService = { handleSumsubDocMonitoringFire: jest.fn().mockResolvedValue(undefined) };
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
  //
  // 2026-08-18：Clue 3（按 Sumsub 侧 actionId 查 pending MaterialRefreshCycle）
  // 已删除——它对 Task 11 之后新建的 cycle 恒查不到，是死码；材料重检域自己的
  // 完成收尾改为监听 MaterialRequestReviewService.applyReview() 广播的
  // MATERIAL_REQUEST_REVIEWED 事件（见 material-refresh-review.listener.spec.ts），
  // 不再经过 sumsub-ingestion 这条路由。

  function buildActionEvent(externalActionId = 'EA1'): SumsubWebhookEvent {
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

  it('applicantActionReviewed, externalActionId 不属于本账（applyReview 返回 null）→ 静默放行，不炸、不再落到已删除的 Clue 3', async () => {
    // Clue 3 删除之后，一个不属于材料请求账的 externalActionId 应该安静地
    // 掉到 Clues 4&5（按 applicantId 查 customer）；找不到 customer 时只留一条
    // warn 日志，不抛异常、不把事件打成 FAILED。
    materialRequestReviewService.applyReview.mockResolvedValue(null);
    const event = buildActionEvent('some-other-domain-action-id');

    const result = await service.dispatch(event);

    expect(materialRequestReviewService.applyReview).toHaveBeenCalledWith({
      externalActionId: 'some-other-domain-action-id',
      reviewAnswer: 'GREEN',
      reviewRejectType: 'FINAL',
      actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
    });
    // Clue 3 已删除：不再有任何路径调用 material-refresh 的完成逻辑。
    expect(materialRefreshService.handleSumsubDocMonitoringFire).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  describe('buildDedupeKey (第一批 2026-08-19)', () => {
    it('B4: 同一客户两条 KYT 裁决，交易号不同 → 去重键必须不同', () => {
      const build = (service as any).buildDedupeKey.bind(service);
      const first = build({
        type: 'applicantKytTxnApproved',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-A',
      });
      const second = build({
        type: 'applicantKytTxnRejected',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-B',
      });
      const sameTypeDiffTxn = build({
        type: 'applicantKytTxnApproved',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-B',
      });

      expect(first).not.toBe(second);
      // 关键：同 type + 同客户，仅交易号不同，也必须区分开
      expect(first).not.toBe(sameTypeDiffTxn);
    });

    it('B4: 非 KYT 事件无 kytTxnId → 行为与改动前一致（不因空串塌成同一把键）', () => {
      const build = (service as any).buildDedupeKey.bind(service);
      const a = build({
        type: 'applicantReviewed',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        reviewResult: { reviewId: 'r-1', attemptId: 'a-1' },
      });
      const b = build({
        type: 'applicantReviewed',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        reviewResult: { reviewId: 'r-2', attemptId: 'a-2' },
      });

      // 既有验证：不同的 reviewId/attemptId 产生不同的键
      expect(a).not.toBe(b);

      // 新增验证：非 KYT 事件的去重键必须包含第六段（kytTxnId，无内容时为空串）
      // 若此段被删除，该断言会失败，钉住本修复不被意外回退
      expect(a.split(':')).toHaveLength(6);
      expect(b.split(':')).toHaveLength(6);
    });
  });
});
