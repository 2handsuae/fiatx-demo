import { Test, TestingModule } from '@nestjs/testing';
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
