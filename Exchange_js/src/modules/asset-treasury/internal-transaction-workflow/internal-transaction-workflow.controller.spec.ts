import { Test, TestingModule } from '@nestjs/testing';
import { InternalTransactionWorkflowController } from './internal-transaction-workflow.controller';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';

describe('InternalTransactionWorkflowController', () => {
  let controller: InternalTransactionWorkflowController;

  const internalTransactionWorkflowService = {
    createManualTransaction: jest.fn(),
    reviewManualTransaction: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'admin-1',
      userNo: 'ADM-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalTransactionWorkflowController],
      providers: [
        {
          provide: InternalTransactionWorkflowService,
          useValue: internalTransactionWorkflowService,
        },
      ],
    }).compile();

    controller = module.get<InternalTransactionWorkflowController>(
      InternalTransactionWorkflowController,
    );
    jest.clearAllMocks();
  });

  it('delegates manual create with admin actor context', async () => {
    internalTransactionWorkflowService.createManualTransaction.mockResolvedValue({
      internalTransaction: { id: 'itx-1' },
    });

    await controller.createManual(adminReq, {
      purpose: 'PAYOUT_FUNDING',
      assetId: 'asset-1',
      fromWalletId: 'wallet-master',
      toWalletId: 'wallet-payout',
      amount: '1',
      reason: 'uat',
    } as any);

    expect(
      internalTransactionWorkflowService.createManualTransaction,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'PAYOUT_FUNDING',
        amount: '1',
      }),
      expect.objectContaining({
        actorType: 'ADMIN',
        userId: 'admin-1',
        roleCodes: ['SUPER_ADMIN'],
      }),
    );
  });
});
