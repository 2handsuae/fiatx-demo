import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { DepositWorkflowService } from './deposit-workflow.service';

describe('DepositTransactionsController', () => {
  let controller: DepositTransactionsController;
  let depositService: { findAll: jest.Mock; findOne: jest.Mock; updateStatus: jest.Mock };
  let inboundSignalsService: {
    findAllForCustomer: jest.Mock;
    createForCustomer: jest.Mock;
    scanForCustomer: jest.Mock;
  };
  let depositWorkflow: {
    approveDeposit: jest.Mock;
    adminReject: jest.Mock;
    adminFreeze: jest.Mock;
    waiveLimitHold: jest.Mock;
    initiateConfiscation: jest.Mock;
  };

  beforeEach(async () => {
    depositService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    };
    inboundSignalsService = {
      findAllForCustomer: jest.fn(),
      createForCustomer: jest.fn(),
      scanForCustomer: jest.fn(),
    };
    depositWorkflow = {
      approveDeposit: jest.fn(),
      adminReject: jest.fn(),
      adminFreeze: jest.fn(),
      waiveLimitHold: jest.fn(),
      initiateConfiscation: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepositTransactionsController],
      providers: [
        {
          provide: DepositTransactionsService,
          useValue: depositService,
        },
        {
          provide: InboundTransferSignalsService,
          useValue: inboundSignalsService,
        },
        {
          provide: DepositWorkflowService,
          useValue: depositWorkflow,
        },
      ],
    }).compile();

    controller = module.get<DepositTransactionsController>(
      DepositTransactionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('waiveLimitHold rejects a CUSTOMER token with ForbiddenException (no self-waive)', () => {
    expect(() =>
      controller.waiveLimitHold('dep-1', { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.waiveLimitHold).not.toHaveBeenCalled();
  });

  it('waiveLimitHold forwards to the workflow with the admin actor for an ADMIN token', async () => {
    depositWorkflow.waiveLimitHold.mockResolvedValue({});

    await controller.waiveLimitHold('dep-1', {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'OPERATOR' },
    });

    expect(depositWorkflow.waiveLimitHold).toHaveBeenCalledWith('dep-1', {
      actorId: 'admin-1',
      actorRole: 'OPERATOR',
    });
  });

  it('confiscate rejects a CUSTOMER token with ForbiddenException (assertAdmin-first)', () => {
    expect(() =>
      controller.confiscate('dep-1', { reason: 'x' }, { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.initiateConfiscation).not.toHaveBeenCalled();
  });

  it('confiscate forwards to the workflow with an admin approval actor for an ADMIN token', async () => {
    depositWorkflow.initiateConfiscation.mockResolvedValue({ approvalNo: 'APR-1' });

    await controller.confiscate('dep-1', { reason: 'below min' }, {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] },
    });

    expect(depositWorkflow.initiateConfiscation).toHaveBeenCalledWith(
      'dep-1',
      { reason: 'below min' },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['OPS_OFFICER'] }),
    );
  });

  it('should route customer inbound signal listing through inbound signal service', async () => {
    inboundSignalsService.findAllForCustomer.mockResolvedValue({ items: [], total: 0 });

    await controller.findMyInboundSignals(
      { user: { userId: 'cust-1' } },
      { walletId: 'wallet-1' } as any,
    );

    expect(inboundSignalsService.findAllForCustomer).toHaveBeenCalledWith('cust-1', {
      walletId: 'wallet-1',
    });
  });
});
