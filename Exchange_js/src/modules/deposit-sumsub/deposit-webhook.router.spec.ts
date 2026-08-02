import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';

describe('DepositWebhookRouter', () => {
  let kytVerdictHandler: jest.Mocked<DepositKytVerdictHandler>;
  let router: DepositWebhookRouter;

  beforeEach(() => {
    kytVerdictHandler = { handle: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<DepositKytVerdictHandler>;
    router = new DepositWebhookRouter(kytVerdictHandler);
  });

  it('routes applicantKytTxnApproved to kytVerdictHandler', async () => {
    const payload = { type: 'applicantKytTxnApproved', kytTxnId: 'T1' };

    await router.route(payload);

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
    expect(kytVerdictHandler.handle).toHaveBeenCalledWith(payload);
  });

  it.each([
    'applicantKytTxnApproved',
    'applicantKytTxnRejected',
    'applicantKytTxnAwaitingUser',
    'applicantKytOnHold',
    'applicantKytTxnReviewed',
  ])('routes %s to kytVerdictHandler', async (type) => {
    await router.route({ type, kytTxnId: 'T1' });

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes applicantKytTxnCreated to kytVerdictHandler (handler itself ignores it, no state change)', async () => {
    await router.route({ type: 'applicantKytTxnCreated', kytTxnId: 'T1' });

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('does not throw and does not route applicantActionReviewed (dead branch retired — Task 9: deposit 纯 KYT 驱动)', async () => {
    await expect(router.route({ type: 'applicantActionReviewed' })).resolves.toBeUndefined();

    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });

  it('does not throw and calls no handler for an unknown type', async () => {
    await expect(router.route({ type: 'somethingUnknown' })).resolves.toBeUndefined();

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
