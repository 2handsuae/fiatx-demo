import { SwapWebhookRouter } from './swap-webhook.router';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';

/**
 * Task 5: mirrors deposit-webhook.router.spec.ts / withdraw-webhook.router.spec.ts
 * (deliberate fork — hand-rolled mock, bypasses Nest DI).
 */
describe('SwapWebhookRouter', () => {
  let kytVerdictHandler: jest.Mocked<SwapKytVerdictHandler>;
  let router: SwapWebhookRouter;

  beforeEach(() => {
    kytVerdictHandler = {
      handle: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SwapKytVerdictHandler>;
    router = new SwapWebhookRouter(kytVerdictHandler);
  });

  it('routes applicantKytTxnApproved to kytVerdictHandler and returns its boolean', async () => {
    const payload = { type: 'applicantKytTxnApproved', kytTxnId: 'T1' };

    const result = await router.route(payload);

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
    expect(kytVerdictHandler.handle).toHaveBeenCalledWith(payload);
    expect(result).toBe(true);
  });

  it('propagates false from kytVerdictHandler (no swap owns this kytTxnId — true cross-domain orphan)', async () => {
    kytVerdictHandler.handle.mockResolvedValue(false);

    const result = await router.route({
      type: 'applicantKytTxnApproved',
      kytTxnId: 'UNKNOWN',
    });

    expect(result).toBe(false);
  });

  it.each([
    'applicantKytTxnApproved',
    'applicantKytTxnRejected',
    'applicantKytTxnAwaitingUser',
    'applicantKytOnHold',
    'applicantKytTxnReviewed',
    'applicantKytTxnCreated',
  ])('routes %s to kytVerdictHandler', async (type) => {
    await router.route({ type, kytTxnId: 'T1' });

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('does not throw and calls no handler for an unknown type, returns false', async () => {
    await expect(router.route({ type: 'somethingUnknown' })).resolves.toBe(
      false,
    );

    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });

  it('官方 on-hold 类型 applicantKytOnHold（无 Txn）必须被路由', async () => {
    await router.route({ type: 'applicantKytOnHold', kytTxnId: 'T-onhold' });
    expect(kytVerdictHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytOnHold' }),
    );
  });

  it('拼错的 applicantKytTxnOnHold 不再被识别（防回退）', async () => {
    await router.route({ type: 'applicantKytTxnOnHold', kytTxnId: 'T-typo' });
    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });
});
