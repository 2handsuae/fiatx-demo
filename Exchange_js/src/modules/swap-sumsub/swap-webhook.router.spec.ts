import { SwapWebhookRouter } from './swap-webhook.router';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapApplicantActionHandler } from './applicant-action.handler';

/**
 * Task 5: mirrors deposit-webhook.router.spec.ts / withdraw-webhook.router.spec.ts
 * (deliberate fork — hand-rolled mock, bypasses Nest DI).
 * Task 13: added applicantActionHandler mock + the applicantActionReviewed branch tests.
 */
describe('SwapWebhookRouter', () => {
  let kytVerdictHandler: jest.Mocked<SwapKytVerdictHandler>;
  let applicantActionHandler: jest.Mocked<SwapApplicantActionHandler>;
  let router: SwapWebhookRouter;

  beforeEach(() => {
    kytVerdictHandler = {
      handle: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SwapKytVerdictHandler>;
    applicantActionHandler = {
      handle: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SwapApplicantActionHandler>;
    router = new SwapWebhookRouter(kytVerdictHandler, applicantActionHandler);
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

  // ── Task 13: applicantActionReviewed ───────────────────────────────────

  it('routes applicantActionReviewed to applicantActionHandler and returns its boolean', async () => {
    const payload = {
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    };

    const result = await router.route(payload);

    expect(applicantActionHandler.handle).toHaveBeenCalledTimes(1);
    expect(applicantActionHandler.handle).toHaveBeenCalledWith(payload);
    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('propagates false from applicantActionHandler (no swap customer owns this externalActionId)', async () => {
    applicantActionHandler.handle.mockResolvedValue(false);

    const result = await router.route({
      type: 'applicantActionReviewed',
      externalActionId: 'ZZZ',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(result).toBe(false);
  });
});
