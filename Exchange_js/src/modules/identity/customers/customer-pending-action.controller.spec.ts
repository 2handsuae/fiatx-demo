import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { CustomerPendingActionService } from './customer-pending-action.service';

describe('CustomerPendingActionController', () => {
  let controller: CustomerPendingActionController;
  let pendingActionService: { get: jest.Mock };

  beforeEach(async () => {
    pendingActionService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerPendingActionController],
      providers: [
        {
          provide: CustomerPendingActionService,
          useValue: pendingActionService,
        },
      ],
    }).compile();

    controller = module.get<CustomerPendingActionController>(
      CustomerPendingActionController,
    );
  });

  it('resolves the calling customer from the JWT and delegates to the service — no logic of its own', async () => {
    pendingActionService.get.mockResolvedValue({
      externalActionId: 'EA1',
      reason: 'KYT_REJECTED',
    });

    const result = await controller.getPendingAction({
      user: { type: 'CUSTOMER', userId: 'cust-1' },
    });

    expect(pendingActionService.get).toHaveBeenCalledWith('cust-1');
    expect(result).toEqual({ externalActionId: 'EA1', reason: 'KYT_REJECTED' });
  });

  it('returns null as-is when the service has nothing to expose (硬线/tipping-off)', async () => {
    pendingActionService.get.mockResolvedValue(null);

    const result = await controller.getPendingAction({
      user: { type: 'CUSTOMER', userId: 'cust-1' },
    });

    expect(result).toBeNull();
  });

  it('rejects a non-customer (e.g. admin) token', () => {
    // getPendingAction throws synchronously (mirrors onboarding-customer.controller.ts's
    // ensureCustomer pattern) — Nest's exception filter catches this fine on
    // a real request; a unit test calling the method directly must assert a
    // sync throw, not a rejected promise.
    expect(() =>
      controller.getPendingAction({
        user: { type: 'ADMIN', userId: 'admin-1' },
      }),
    ).toThrow(ForbiddenException);
    expect(pendingActionService.get).not.toHaveBeenCalled();
  });
});
