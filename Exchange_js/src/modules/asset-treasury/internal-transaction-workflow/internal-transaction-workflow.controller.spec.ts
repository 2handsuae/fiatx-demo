import { Test, TestingModule } from '@nestjs/testing';
import { InternalCollectionWorkflowOrchestrator } from '../../../orchestrators/internal-collection-workflow.orchestrator';
import { InternalTransactionWorkflowController } from './internal-transaction-workflow.controller';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';

describe('InternalTransactionWorkflowController', () => {
  let controller: InternalTransactionWorkflowController;

  const internalTransactionWorkflowService = {
    createManualTransaction: jest.fn(),
    reviewManualTransaction: jest.fn(),
  };

  const internalCollectionWorkflowOrchestrator = {
    listCollectionWallets: jest.fn(),
    reconcileCollectionWallet: jest.fn(),
    reconcileMissingCollections: jest.fn(),
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
        {
          provide: InternalCollectionWorkflowOrchestrator,
          useValue: internalCollectionWorkflowOrchestrator,
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

  it('delegates legacy deposit-driven reconciliation with admin operator context', async () => {
    internalCollectionWorkflowOrchestrator.reconcileMissingCollections.mockResolvedValue({
      scanned: 1,
      created: 0,
      idempotent: 1,
      skipped: 0,
      failed: 0,
      items: [],
    });

    await controller.reconcileCollections(
      adminReq,
      {
        depositNo: 'DEP-001',
        onlyMissing: true,
        dryRun: true,
      } as any,
    );

    expect(
      internalCollectionWorkflowOrchestrator.reconcileMissingCollections,
    ).toHaveBeenCalledWith({
      depositId: undefined,
      depositNo: 'DEP-001',
      onlyMissing: true,
      dryRun: true,
      operatorId: 'admin-1',
    });
  });
});
