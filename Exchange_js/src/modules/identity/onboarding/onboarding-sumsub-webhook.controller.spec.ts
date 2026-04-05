import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingSumsubWebhookController } from './onboarding-sumsub-webhook.controller';
import { OnboardingService } from './onboarding.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';

describe('OnboardingSumsubWebhookController', () => {
  const onboardingServiceMock = {
    handleSumsubVerificationEvent: jest.fn(),
  };
  const sumsubClientMock = {
    verifyWebhookSignature: jest.fn(),
  };

  let controller: OnboardingSumsubWebhookController;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      controllers: [OnboardingSumsubWebhookController],
      providers: [
        {
          provide: OnboardingService,
          useValue: onboardingServiceMock,
        },
        {
          provide: SumsubClient,
          useValue: sumsubClientMock,
        },
      ],
    }).compile();
    controller = moduleRef.get(OnboardingSumsubWebhookController);
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('passes raw webhook payload to onboarding service handler', async () => {
    sumsubClientMock.verifyWebhookSignature.mockReturnValue(true);
    onboardingServiceMock.handleSumsubVerificationEvent.mockResolvedValue({ ok: true });

    await controller.handleWebhook(
      { rawBody: Buffer.from('{"type":"applicantPending"}') } as any,
      { type: 'applicantPending', applicantId: 'app-1' } as any,
      'digest-signature',
      'HMAC_SHA256_HEX',
    );

    expect(sumsubClientMock.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      'digest-signature',
      'HMAC_SHA256_HEX',
    );
    expect(onboardingServiceMock.handleSumsubVerificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'applicantPending',
        applicantId: 'app-1',
      }),
      expect.objectContaining({
        rawBody: expect.any(Buffer),
        signature: 'digest-signature',
        digestAlg: 'HMAC_SHA256_HEX',
        simulated: false,
        actorId: 'SUMSUB',
      }),
    );
  });

  it('rejects webhook payloads with invalid signature', async () => {
    sumsubClientMock.verifyWebhookSignature.mockReturnValue(false);

    expect(() =>
      controller.handleWebhook(
        { rawBody: Buffer.from('{"type":"applicantPending"}') } as any,
        { type: 'applicantPending', applicantId: 'app-1' } as any,
        'bad-signature',
        'HMAC_SHA256_HEX',
      ),
    ).toThrow(UnauthorizedException);

    expect(onboardingServiceMock.handleSumsubVerificationEvent).not.toHaveBeenCalled();
  });
});
