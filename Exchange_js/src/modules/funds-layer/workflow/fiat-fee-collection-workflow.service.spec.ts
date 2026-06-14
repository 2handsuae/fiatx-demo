import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

describe('FiatFeeCollectionWorkflowService', () => {
  let service: FiatFeeCollectionWorkflowService;
  let transfers: any, fundsFlow: any, prisma: any;

  beforeEach(async () => {
    transfers = { createTransfer: jest.fn().mockResolvedValue({ id: 't' }) };
    fundsFlow = { createLeg: jest.fn().mockResolvedValue({ id: 'f' }) };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      withdrawTransaction: { findUnique: jest.fn() },
      internalTransaction: { findFirst: jest.fn(), findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatFeeCollectionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: InternalTransferService, useValue: transfers },
        { provide: FundsFlowService, useValue: fundsFlow },
        {
          provide: SystemWalletResolver,
          useValue: {
            resolve: jest.fn((assetId: string, role: string) => Promise.resolve({ id: `w-${role}` })),
            resolveCustomer: jest.fn((assetId: string, role: string, owner: string) => Promise.resolve({ id: `w-${role}-${owner}` })),
          },
        },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
      ],
    }).compile();

    service = module.get(FiatFeeCollectionWorkflowService);
  });

  it('collectSwapFees spawns F_OPS->F_FEE for both service fee (:FEE) and spread (:SPREAD) — Model A', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-1', swapNo: 'SWP-1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CUST-1',
      toAssetId: 'a-aed', feeAmount: '0.10', spreadAmount: '0.18', toAsset: { type: 'FIAT' },
    });
    prisma.internalTransaction.findFirst.mockResolvedValue(null);

    await service.collectSwapFees('swap-1');

    // Model A: service fee no longer round-trips the client VIBAN — both fee and
    // spread are company-side F_OPS->F_FEE (path FIAT_SPREAD_COLLECT), disambiguated by sourceId.
    const feeCall = transfers.createTransfer.mock.calls.find((c: any) => c[0].sourceId === 'swap-1:FEE')[0];
    expect(feeCall.path).toBe('FIAT_SPREAD_COLLECT');
    expect(feeCall.amount.toString()).toBe('0.1');
    expect(feeCall.fromWalletId).toBe('w-F_OPS');
    expect(feeCall.toWalletId).toBe('w-F_FEE');
    expect(feeCall.sourceType).toBe('FIAT_FEE_COLLECTION');
    expect(feeCall.accountingClass).toBe('B');
    expect(feeCall.medium).toBe('BANK');
    const spreadCall = transfers.createTransfer.mock.calls.find((c: any) => c[0].sourceId === 'swap-1:SPREAD')[0];
    expect(spreadCall.path).toBe('FIAT_SPREAD_COLLECT');
    expect(spreadCall.fromWalletId).toBe('w-F_OPS');
    expect(spreadCall.toWalletId).toBe('w-F_FEE');
    expect(spreadCall.ownerType).toBe('PLATFORM');
    expect(fundsFlow.createLeg).toHaveBeenCalledTimes(2);
  });

  it('no-op when TO asset is not fiat', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({ id: 's2', toAsset: { type: 'CRYPTO' }, feeAmount: '1', spreadAmount: '0' });
    await service.collectSwapFees('s2');
    expect(transfers.createTransfer).not.toHaveBeenCalled();
  });

  it('idempotent: existing transfer for sourceId is reused (no duplicate)', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({ id: 's3', swapNo: 'SWP-3', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1', toAssetId: 'a-aed', feeAmount: '0.10', spreadAmount: '0', toAsset: { type: 'FIAT' } });
    prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });
    await service.collectSwapFees('s3');
    expect(transfers.createTransfer).not.toHaveBeenCalled();
  });

  // onFundsFlowStatusChanged removed in Task 6 — fee CLEAR TB mirror now handled
  // by InternalTransferWorkflowService.mirrorPhysicalTransfer (FEE_DECOMMINGLE code).

  describe('onFiatWithdrawalSucceeded', () => {
    it('spawns VIBAN->F_FEE for the withdraw fee', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'w-1', withdrawNo: 'WD-1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CUST-1',
        assetId: 'a-aed', feeAmount: '5', asset: { type: 'FIAT' },
      });
      prisma.internalTransaction.findFirst.mockResolvedValue(null);
      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-1' });
      const call = transfers.createTransfer.mock.calls[0][0];
      expect(call.path).toBe('FIAT_FEE_COLLECT');
      expect(call.amount.toString()).toBe('5');
      expect(call.fromWalletId).toBe('w-C_VIBAN-c1');
      expect(call.sourceId).toBe('w-1:FEE');
    });

    it('skips when fee is zero', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ id: 'w-2', assetId: 'a-aed', feeAmount: '0', ownerId: 'c1', asset: { type: 'FIAT' } });
      prisma.internalTransaction.findFirst.mockResolvedValue(null);
      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-2' });
      expect(transfers.createTransfer).not.toHaveBeenCalled();
    });

    it('idempotent: existing fee transfer is reused', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ id: 'w-3', withdrawNo:'WD-3', ownerType:'CUSTOMER', ownerId:'c1', ownerNo:'C1', assetId:'a-aed', feeAmount:'5', asset:{type:'FIAT'} });
      prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });
      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-3' });
      expect(transfers.createTransfer).not.toHaveBeenCalled();
    });
  });
});
