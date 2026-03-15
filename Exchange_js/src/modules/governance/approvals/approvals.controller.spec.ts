import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsController', () => {
  let controller: ApprovalsController;
  const approvalsService = {
    create: jest.fn(),
    submit: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    cancel: jest.fn(),
    getById: jest.fn(),
    list: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'checker-1',
      userNo: 'ADM-002',
      role: 'DPO',
      roleCodes: ['DPO'],
    },
  };
  const customerReq = {
    user: {
      type: 'CUSTOMER',
      userId: 'cust-1',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApprovalsController],
      providers: [{ provide: ApprovalsService, useValue: approvalsService }],
    }).compile();

    controller = module.get<ApprovalsController>(ApprovalsController);
    jest.clearAllMocks();
  });

  it('delegates approve with admin actor context', async () => {
    approvalsService.approve.mockResolvedValue({ id: 'approval-1', status: 'APPROVED' });

    await controller.approve(adminReq, 'approval-1', { reason: 'looks good' } as any);

    expect(approvalsService.approve).toHaveBeenCalledWith(
      'approval-1',
      { reason: 'looks good' },
      {
        actorType: 'ADMIN',
        userId: 'checker-1',
        userNo: 'ADM-002',
        role: 'DPO',
        roleCodes: ['DPO'],
      },
    );
  });

  it('rejects non-admin approval access', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });
});
