import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { OnboardingService } from './onboarding.service';
import { OnboardingSumsubSimulationController } from './onboarding-sumsub-simulation.controller';

describe('OnboardingSumsubSimulationController', () => {
  const onboardingServiceMock = {
    handleSumsubVerificationEvent: jest.fn(),
  };
  const originalNodeEnv = process.env.NODE_ENV;

  let controller: OnboardingSumsubSimulationController;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      controllers: [OnboardingSumsubSimulationController],
      providers: [
        {
          provide: OnboardingService,
          useValue: onboardingServiceMock,
        },
      ],
    }).compile();
    controller = moduleRef.get(OnboardingSumsubSimulationController);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }

    process.env.NODE_ENV = originalNodeEnv;
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('does not register the admin permission guard on the simulation controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OnboardingSumsubSimulationController) ?? [];

    expect(guards).not.toContain(AdminPermissionGuard);
  });

  it('builds a simulated Sumsub payload and routes it to the same service method', async () => {
    process.env.NODE_ENV = 'development';
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

  it('rejects simulation outside development mode', () => {
    process.env.NODE_ENV = 'production';

    expect(() =>
      controller.simulate(
        { user: { type: 'CUSTOMER', userId: 'customer-1' } } as any,
        { eventType: 'applicantWorkflowCompleted' } as any,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-customer tokens through ensureCustomer', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      controller.simulate(
        { user: { type: 'ADMIN', userId: 'admin-1' } } as any,
        { eventType: 'applicantWorkflowCompleted' } as any,
      ),
    ).toThrow(ForbiddenException);
  });
});
