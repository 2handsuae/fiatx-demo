import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FiatSettlementWorkflowService } from './fiat-settlement-workflow.service';

describe('FiatSettlementWorkflowService.onSwapSucceeded', () => {
  let service: FiatSettlementWorkflowService;
  let batch: any, consumer: any, transfers: any, fundsFlow: any, accounting: any, wallets: any, prisma: any;

  beforeEach(async () => {
    batch = { createBatch: jest.fn().mockResolvedValue({ id: 'b-1', batchNo: 'OSB-1' }), recomputeBatch: jest.fn() };
    consumer = {
      findOpenFiatBySwap: jest.fn().mockResolvedValue([
        { id: 'o-aed', direction: 'OUT', amount: '5', assetId: 'a-aed', assetCode: 'AED', ownerId: 'c1', ownerType: 'CUSTOMER', ownerNo: 'CUST-1', sourceNo: 'SWP-1' },
      ]),
      lockToTransfer: jest.fn().mockResolvedValue({ count: 1 }),
      settle: jest.fn().mockResolvedValue({ count: 1 }),
    };
    transfers = { createTransfer: jest.fn().mockResolvedValue({ id: 't-1', internalTxNo: 'ITX-1' }) };
    fundsFlow = { createLeg: jest.fn().mockResolvedValue({ id: 'f-hop' }), updateStatus: jest.fn() };
    accounting = { applyAccounting: jest.fn() };
    wallets = {
      resolve: jest.fn((assetId: string, role: string) => Promise.resolve({ id: `w-${role}` })),
      resolveCustomer: jest.fn((assetId: string, role: string, owner: string) => Promise.resolve({ id: `w-${role}-${owner}` })),
    };
    prisma = { internalTransaction: { findUnique: jest.fn() }, internalFund: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatSettlementWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batch },
        { provide: OutstandingConsumerService, useValue: consumer },
        { provide: InternalTransferService, useValue: transfers },
        { provide: FundsFlowService, useValue: fundsFlow },
        { provide: FundsAccountingService, useValue: accounting },
        { provide: SystemWalletResolver, useValue: wallets },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
      ],
    }).compile();
    service = module.get(FiatSettlementWorkflowService);
  });

  it('OUT outstanding: batch + FIAT_SETTLE_OUT transfer + 2 funds (hop2 held) + lock', async () => {
    await service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' });

    expect(batch.createBatch).toHaveBeenCalledTimes(1);
    expect(wallets.resolveCustomer).toHaveBeenCalledWith('a-aed', 'C_VIBAN', 'c1');
    expect(wallets.resolve).toHaveBeenCalledWith('a-aed', 'F_SET');
    expect(wallets.resolve).toHaveBeenCalledWith('a-aed', 'F_LIQ');

    const tArgs = transfers.createTransfer.mock.calls[0][0];
    expect(tArgs).toMatchObject({ path: 'FIAT_SETTLE_OUT', accountingClass: 'B', medium: 'BANK', settlementBatchId: 'b-1' });
    // idempotency key = swapId:outstandingId
    expect(tArgs.sourceId).toBe('swap-1:o-aed');

    expect(fundsFlow.createLeg).toHaveBeenCalledTimes(2);
    const hop1 = fundsFlow.createLeg.mock.calls[0][0];
    const hop2 = fundsFlow.createLeg.mock.calls[1][0];
    // both legs created in CREATED (hop2 held until hop1 confirms)
    expect(hop1).toMatchObject({ fromWalletId: 'w-C_VIBAN-c1', toWalletId: 'w-F_SET', status: 'CREATED' });
    expect(hop2).toMatchObject({ fromWalletId: 'w-F_SET', toWalletId: 'w-F_LIQ', status: 'CREATED' });

    expect(consumer.lockToTransfer).toHaveBeenCalledWith(['o-aed'], 'b-1', 't-1');
    expect(accounting.applyAccounting).not.toHaveBeenCalled();
  });

  it('IN outstanding: route is F_LIQ -> F_SET -> C_VIBAN (FIAT_SETTLE_IN)', async () => {
    consumer.findOpenFiatBySwap.mockResolvedValue([
      { id: 'o-in', direction: 'IN', amount: '7', assetId: 'a-aed', assetCode: 'AED', ownerId: 'c2', ownerType: 'CUSTOMER', ownerNo: 'CUST-2', sourceNo: 'SWP-2' },
    ]);
    await service.onSwapSucceeded({ swapId: 'swap-2', swapNo: 'SWP-2', ownerId: 'c2' });
    const tArgs = transfers.createTransfer.mock.calls[0][0];
    expect(tArgs).toMatchObject({ path: 'FIAT_SETTLE_IN' });
    const hop1 = fundsFlow.createLeg.mock.calls[0][0];
    const hop2 = fundsFlow.createLeg.mock.calls[1][0];
    expect(hop1).toMatchObject({ fromWalletId: 'w-F_LIQ', toWalletId: 'w-F_SET' });
    expect(hop2).toMatchObject({ fromWalletId: 'w-F_SET', toWalletId: 'w-C_VIBAN-c2' });
  });

  it('no fiat outstanding: no-op (no batch)', async () => {
    consumer.findOpenFiatBySwap.mockResolvedValue([]);
    await service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' });
    expect(batch.createBatch).not.toHaveBeenCalled();
  });
});
