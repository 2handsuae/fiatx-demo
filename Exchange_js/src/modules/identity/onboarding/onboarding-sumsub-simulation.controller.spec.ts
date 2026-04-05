import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
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

  it('does not register the admin permission guard on the simulation controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OnboardingSumsubSimulationController) ?? [];

    expect(guards).not.toContain(AdminPermissionGuard);
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

  it('rejects non-customer tokens through ensureCustomer', () => {
    expect(() =>
      controller.simulate(
        { user: { type: 'ADMIN', userId: 'admin-1' } } as any,
        { eventType: 'applicantWorkflowCompleted' } as any,
      ),
    ).toThrow(ForbiddenException);
  });
});
