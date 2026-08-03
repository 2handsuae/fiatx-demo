import { SumsubIngestionService } from './sumsub-ingestion.service';
import { DepositWebhookRouter } from '../deposit-sumsub/deposit-webhook.router';
import { WithdrawWebhookRouter } from '../withdraw-sumsub/withdraw-webhook.router';
import { SumsubWebhookEvent } from '@prisma/client';

/**
 * Task 4: focused unit test for the deposit-first / withdraw-second cascade added
 * to dispatch(). No prior sumsub-ingestion.service.spec.ts existed — this file is
 * new, scoped to the cascade only (everything else in dispatch() — clue 1-5,
 * simulation event types — is exercised elsewhere/e2e, untouched by this task).
 * Constructs the service directly with hand-rolled mocks (same lightweight style
 * as deposit-kyt-verdict.handler.spec.ts) rather than booting the full Nest DI
 * graph — dispatch()'s KYT-verdict branch only touches prisma.sumsubWebhookEvent
 * and the two routers.
 */
describe('SumsubIngestionService — deposit/withdraw KYT cascade (Task 4)', () => {
  let prisma: any;
  let depositWebhookRouter: jest.Mocked<DepositWebhookRouter>;
  let withdrawWebhookRouter: jest.Mocked<WithdrawWebhookRouter>;
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
    );
  });

  it('deposit hit (route()=true) → withdraw router NOT called', async () => {
    depositWebhookRouter.route.mockResolvedValue(true);
    const event = buildEvent('applicantKytTxnApproved');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).not.toHaveBeenCalled();
    expect(result).toEqual({ routedTo: 'deposit-sumsub', type: 'applicantKytTxnApproved' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'DEPOSIT_SUMSUB' }) }),
    );
  });

  it('deposit miss (route()=false) → withdraw router IS called', async () => {
    depositWebhookRouter.route.mockResolvedValue(false);
    withdrawWebhookRouter.route.mockResolvedValue(true);
    const event = buildEvent('applicantKytTxnApproved');

    const result = await service.dispatch(event);

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' }),
    );
    expect(result).toEqual({ routedTo: 'withdraw-sumsub', type: 'applicantKytTxnApproved' });
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedTo: 'WITHDRAW_SUMSUB' }) }),
    );
  });

  it('deposit + withdraw both miss (true orphan) → no throw, still marks PROCESSED', async () => {
    depositWebhookRouter.route.mockResolvedValue(false);
    withdrawWebhookRouter.route.mockResolvedValue(false);
    const event = buildEvent('applicantKytOnHold', 'UNKNOWN');

    await expect(service.dispatch(event)).resolves.toBeDefined();

    expect(depositWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(withdrawWebhookRouter.route).toHaveBeenCalledTimes(1);
    expect(prisma.sumsubWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });
});
