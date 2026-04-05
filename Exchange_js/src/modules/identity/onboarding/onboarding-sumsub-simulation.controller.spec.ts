import { OnboardingSumsubSimulationController } from './onboarding-sumsub-simulation.controller';

describe('OnboardingSumsubSimulationController', () => {
  const onboardingServiceMock = {
    handleSumsubVerificationEvent: jest.fn(),
  };

  let controller: OnboardingSumsubSimulationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OnboardingSumsubSimulationController(onboardingServiceMock as any);
  });

  it('builds a simulated Sumsub payload and routes it to the same service method', async () => {
    onboardingServiceMock.handleSumsubVerificationEvent.mockResolvedValue({ ok: true });

    await controller.simulate(
      { user: { type: 'CUSTOMER', userId: 'customer-1' } } as any,
      {
        eventType: 'applicantWorkflowCompleted',
        levelName: 'wave3-level-2',
      } as any,
    );

    expect(onboardingServiceMock.handleSumsubVerificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'applicantWorkflowCompleted',
      }),
      expect.objectContaining({
        simulated: true,
        actorId: 'customer-1',
        levelName: 'wave3-level-2',
      }),
    );
  });
});
