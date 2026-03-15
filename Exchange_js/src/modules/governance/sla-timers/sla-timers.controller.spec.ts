import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SlaTimersController } from './sla-timers.controller';
import { SlaTimersService } from './sla-timers.service';

describe('SlaTimersController', () => {
  let controller: SlaTimersController;
  const slaTimersService = {
    list: jest.fn(),
    getById: jest.fn(),
    recalc: jest.fn(),
    close: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'admin-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlaTimersController],
      providers: [{ provide: SlaTimersService, useValue: slaTimersService }],
    }).compile();

    controller = module.get<SlaTimersController>(SlaTimersController);
    jest.clearAllMocks();
  });

  it('delegates recalc with admin actor context', async () => {
    slaTimersService.recalc.mockResolvedValue({ id: 'timer-1', status: 'ACTIVE' });

    await controller.recalc(adminReq, 'timer-1', { dueInSeconds: 30 } as any);

    expect(slaTimersService.recalc).toHaveBeenCalledWith(
      'timer-1',
      { dueInSeconds: 30 },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );
  });

  it('rejects non-admin SLA timer access', () => {
    expect(() => controller.list({} as any, customerReq)).toThrow(ForbiddenException);
  });
});
