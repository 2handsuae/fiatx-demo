import { Test, TestingModule } from '@nestjs/testing';
import { InternalCollectionWorkflowOrchestrator } from '../../../orchestrators/internal-collection-workflow.orchestrator';
import { InternalCollectionWalletsController } from './internal-collection-wallets.controller';

describe('InternalCollectionWalletsController', () => {
  let controller: InternalCollectionWalletsController;

  const internalCollectionWorkflowOrchestrator = {
    listCollectionWallets: jest.fn(),
    reconcileCollectionWallet: jest.fn(),
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
      controllers: [InternalCollectionWalletsController],
      providers: [
        {
          provide: InternalCollectionWorkflowOrchestrator,
          useValue: internalCollectionWorkflowOrchestrator,
        },
      ],
    }).compile();

    controller = module.get<InternalCollectionWalletsController>(
      InternalCollectionWalletsController,
    );
    jest.clearAllMocks();
  });

  it('lists collection wallets with query params', async () => {
    internalCollectionWorkflowOrchestrator.listCollectionWallets.mockResolvedValue({
      items: [],
      total: 0,
    });

    await controller.listCollectionWallets({
      skip: 10,
      take: 20,
      assetId: 'asset-btc',
    } as any);

    expect(
      internalCollectionWorkflowOrchestrator.listCollectionWallets,
    ).toHaveBeenCalledWith({
      skip: 10,
      take: 20,
      assetId: 'asset-btc',
    });
  });

  it('delegates wallet-driven collection reconcile to orchestrator', async () => {
    internalCollectionWorkflowOrchestrator.reconcileCollectionWallet.mockResolvedValue({
      walletId: 'wallet-deposit',
      action: 'WOULD_CREATE',
    });

    await controller.reconcileCollectionWallet(
      adminReq,
      'wallet-deposit',
      {
        dryRun: true,
      } as any,
    );

    expect(
      internalCollectionWorkflowOrchestrator.reconcileCollectionWallet,
    ).toHaveBeenCalledWith({
      walletId: 'wallet-deposit',
      dryRun: true,
      operatorId: 'admin-1',
    });
  });
});
