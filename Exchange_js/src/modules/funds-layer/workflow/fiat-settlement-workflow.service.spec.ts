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
import { InternalFundAction } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

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

describe('onFundsFlowStatusChanged', () => {
  let service: FiatSettlementWorkflowService;
  let batch: any, consumer: any, transfers: any, fundsFlow: any, accounting: any, wallets: any, prisma: any;

  const fiatTransfer = { id: 't-1', sourceType: 'FIAT_SETTLEMENT', settlementBatchId: 'b-1', assetId: 'a-aed' };

  beforeEach(async () => {
    batch = { createBatch: jest.fn().mockResolvedValue({ id: 'b-1', batchNo: 'OSB-1' }), recomputeBatch: jest.fn() };
    consumer = {
      findOpenFiatBySwap: jest.fn().mockResolvedValue([]),
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

  it('hop1 CONFIRMED releases hop2 with SUBMIT', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'f-hop1', toWalletId: 'w-F_SET', fromWalletId: 'w-C_VIBAN-c1', status: 'CONFIRMED' },
      { id: 'f-hop2', fromWalletId: 'w-F_SET', toWalletId: 'w-F_LIQ', status: 'CREATED' },
    ]);
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop1', internalTransferId: 't-1', oldStatus: 'CONFIRMING', newStatus: 'CONFIRMED' });
    expect(fundsFlow.updateStatus).toHaveBeenCalledWith('f-hop2', { action: InternalFundAction.SUBMIT }, 'SYSTEM');
  });

  it('hop2 CONFIRMED does not spuriously re-submit (no CREATED sibling downstream of F_LIQ)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'f-hop1', toWalletId: 'w-F_SET', fromWalletId: 'w-C_VIBAN-c1', status: 'CONFIRMED' },
      { id: 'f-hop2', fromWalletId: 'w-F_SET', toWalletId: 'w-F_LIQ', status: 'CONFIRMED' },
    ]);
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop2', internalTransferId: 't-1', oldStatus: 'CONFIRMING', newStatus: 'CONFIRMED' });
    expect(fundsFlow.updateStatus).not.toHaveBeenCalled();
  });

  it('CLEAR finalizes once: settle + drain + recompute', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    consumer.settle.mockResolvedValue({ count: 1 });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop2', internalTransferId: 't-1', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(consumer.settle).toHaveBeenCalledWith('t-1', 'f-hop2');
    expect(accounting.applyAccounting).toHaveBeenCalledWith({ accountingClass: 'B', internalTransferId: 't-1' });
    expect(batch.recomputeBatch).toHaveBeenCalledWith('b-1');
  });

  it('second CLEAR is a no-op (settle latch returns count 0)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    consumer.settle.mockResolvedValue({ count: 0 });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop1', internalTransferId: 't-1', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(accounting.applyAccounting).not.toHaveBeenCalled();
    expect(batch.recomputeBatch).not.toHaveBeenCalled();
  });

  it('ignores non-fiat transfers', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({ id: 't-x', sourceType: 'EOD_SETTLEMENT' });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-x', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(consumer.settle).not.toHaveBeenCalled();
  });

  it('ignores events without internalTransferId or with irrelevant status', async () => {
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: undefined, oldStatus: 'X', newStatus: 'CLEAR' });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-1', oldStatus: 'X', newStatus: 'BROADCASTED' });
    expect(prisma.internalTransaction.findUnique).not.toHaveBeenCalled();
  });
});
