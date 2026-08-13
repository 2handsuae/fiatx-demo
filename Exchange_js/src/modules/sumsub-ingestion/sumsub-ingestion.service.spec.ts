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
    };
    depositWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<DepositWebhookRouter>;
    withdrawWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<WithdrawWebhookRouter>;
    swapWebhookRouter = { route: jest.fn() } as unknown as jest.Mocked<SwapWebhookRouter>;

    service = new SumsubIngestionService(
      prisma,
      {} as any, // onboardingService
      {} as any, // clientRiskAssessmentService
      {} as any, // materialRefreshService
      {} as any, // tierUpgradeCaseService
      {} as any, // depositWorkflowService
      {} as any, // withdrawService
      depositWebhookRouter,
      withdrawWebhookRouter,
      swapWebhookRouter,
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
});
