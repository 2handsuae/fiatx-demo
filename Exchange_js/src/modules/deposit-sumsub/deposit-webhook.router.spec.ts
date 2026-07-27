import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositActionHandler } from './deposit-action.handler';

describe('DepositWebhookRouter', () => {
  let kytVerdictHandler: jest.Mocked<DepositKytVerdictHandler>;
  let actionHandler: jest.Mocked<DepositActionHandler>;
  let router: DepositWebhookRouter;

  beforeEach(() => {
    kytVerdictHandler = { handle: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<DepositKytVerdictHandler>;
    actionHandler = { handle: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<DepositActionHandler>;
    router = new DepositWebhookRouter(kytVerdictHandler, actionHandler);
  });

  it('routes applicantKytTxnApproved to kytVerdictHandler', async () => {
    const payload = { type: 'applicantKytTxnApproved', kytTxnId: 'T1' };

    await router.route(payload);

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
    expect(kytVerdictHandler.handle).toHaveBeenCalledWith(payload);
    expect(actionHandler.handle).not.toHaveBeenCalled();
  });

  it.each([
    'applicantKytTxnApproved',
    'applicantKytTxnRejected',
    'applicantKytTxnAwaitingUser',
    'applicantKytTxnOnHold',
    'applicantKytTxnReviewed',
  ])('routes %s to kytVerdictHandler', async (type) => {
    await router.route({ type, kytTxnId: 'T1' });

    expect(kytVerdictHandler.handle).toHaveBeenCalledTimes(1);
    expect(actionHandler.handle).not.toHaveBeenCalled();
  });

  it('routes applicantActionReviewed to actionHandler', async () => {
    const payload = { type: 'applicantActionReviewed' };

    await router.route(payload);

    expect(actionHandler.handle).toHaveBeenCalledTimes(1);
    expect(actionHandler.handle).toHaveBeenCalledWith(payload);
    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });

  it('routes applicantActionPending to actionHandler', async () => {
    await router.route({ type: 'applicantActionPending' });

    expect(actionHandler.handle).toHaveBeenCalledTimes(1);
    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });

  it('does not call any handler for applicantKytTxnCreated (receipt only)', async () => {
    await router.route({ type: 'applicantKytTxnCreated', kytTxnId: 'T1' });

    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
    expect(actionHandler.handle).not.toHaveBeenCalled();
  });

  it('does not throw and calls no handler for an unknown type', async () => {
    await expect(router.route({ type: 'somethingUnknown' })).resolves.toBeUndefined();

    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
    expect(actionHandler.handle).not.toHaveBeenCalled();
  });
});
