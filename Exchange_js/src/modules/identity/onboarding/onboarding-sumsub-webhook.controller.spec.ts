import { OnboardingSumsubWebhookController } from './onboarding-sumsub-webhook.controller';

describe('OnboardingSumsubWebhookController', () => {
  const onboardingServiceMock = {
    handleSumsubVerificationEvent: jest.fn(),
  };

  let controller: OnboardingSumsubWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OnboardingSumsubWebhookController(onboardingServiceMock as any);
  });

  it('passes raw webhook payload to onboarding service after signature validation', async () => {
    onboardingServiceMock.handleSumsubVerificationEvent.mockResolvedValue({ ok: true });

    await controller.handleWebhook(
      { rawBody: Buffer.from('{"type":"applicantPending"}') } as any,
      { type: 'applicantPending', applicantId: 'app-1' } as any,
      'sha256=test-signature',
    );

    expect(onboardingServiceMock.handleSumsubVerificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'applicantPending',
        applicantId: 'app-1',
      }),
      expect.objectContaining({
        rawBody: expect.any(Buffer),
        signature: 'sha256=test-signature',
        simulated: false,
        actorId: 'SUMSUB',
      }),
    );
  });
});
