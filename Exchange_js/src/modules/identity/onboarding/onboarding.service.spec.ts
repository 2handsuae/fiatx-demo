import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
    },
  };

  let service: OnboardingService;

  beforeEach(() => {
    prismaMock.customerMain.findUnique.mockReset();
    service = new OnboardingService(prismaMock);
  });

  it('should allow swap when canTradeSwap is true', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      canTradeSwap: true,
      canTradeWithdraw: false,
      onboardingStage: 'ONBOARDING_APPROVED',
      onboardingRejectReason: null,
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block withdraw when canTradeWithdraw is false', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      canTradeSwap: true,
      canTradeWithdraw: false,
      onboardingStage: 'CDD_UNDER_REVIEW',
      onboardingRejectReason: null,
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should throw when customer does not exist', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);

    await expect(service.assertTradingEligibility('missing', 'SWAP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should return reinitiate step when onboarding is rejected', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      onboardingStage: 'ONBOARDING_REJECTED',
      onboardingRejectReason: 'CDD rejected',
      canTradeSwap: false,
      canTradeWithdraw: false,
      customerType: 'INDIVIDUAL',
      corporateProfile: null,
      uboProfiles: [],
    });

    const result = await service.getNextStep('c1');
    expect(result.step).toBe('REINITIATE');
    expect(result.action).toBe('REINITIATE_CDD');
  });

  it('should return completed step when customer can trade', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      onboardingStage: 'ONBOARDING_APPROVED',
      onboardingRejectReason: null,
      canTradeSwap: true,
      canTradeWithdraw: true,
      customerType: 'INDIVIDUAL',
      corporateProfile: null,
      uboProfiles: [],
    });

    const result = await service.getNextStep('c1');
    expect(result.step).toBe('COMPLETED');
    expect(result.action).toBe('NONE');
  });
});
