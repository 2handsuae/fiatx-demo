import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FiatSettlementWorkflowService } from './fiat-settlement-workflow.service';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

// neutered in Phase A (real-time inline accounting) — handler tests updated to no-op
describe('FiatSettlementWorkflowService', () => {
  let service: FiatSettlementWorkflowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatSettlementWorkflowService,
        { provide: PrismaService, useValue: {} },
        { provide: SettlementBatchService, useValue: {} },
        { provide: OutstandingConsumerService, useValue: {} },
        { provide: InternalTransferService, useValue: {} },
        { provide: FundsFlowService, useValue: {} },
        { provide: SystemWalletResolver, useValue: {} },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
        { provide: FiatFeeCollectionWorkflowService, useValue: {} },
      ],
    }).compile();
    service = module.get(FiatSettlementWorkflowService);
  });

  it('onSwapSucceeded is a no-op (neutered Phase A)', async () => {
    await expect(
      service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' }),
    ).resolves.toBeUndefined();
  });

  it('onFundsFlowStatusChanged is a no-op (neutered Phase A)', async () => {
    await expect(
      service.onFundsFlowStatusChanged({
        fundsFlowId: 'f-1',
        internalTransferId: 't-1',
        oldStatus: 'CONFIRMED',
        newStatus: 'CLEAR',
      }),
    ).resolves.toBeUndefined();
  });
});
