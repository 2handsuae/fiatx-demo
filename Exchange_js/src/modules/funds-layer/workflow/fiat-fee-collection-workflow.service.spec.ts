import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

describe('FiatFeeCollectionWorkflowService', () => {
  let service: FiatFeeCollectionWorkflowService;
  let transfers: any, fundsFlow: any, accounting: any, prisma: any;

  beforeEach(async () => {
    transfers = { createTransfer: jest.fn().mockResolvedValue({ id: 't' }) };
    fundsFlow = { createLeg: jest.fn().mockResolvedValue({ id: 'f' }) };
    accounting = { drainFeeReceivableAmount: jest.fn() };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      internalTransaction: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatFeeCollectionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: InternalTransferService, useValue: transfers },
        { provide: FundsFlowService, useValue: fundsFlow },
        { provide: FundsAccountingService, useValue: accounting },
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

  it('collectSwapFees spawns VIBAN->F_FEE (fee) and F_LIQ->F_FEE (spread)', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-1', swapNo: 'SWP-1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CUST-1',
      toAssetId: 'a-aed', feeAmount: '0.10', spreadAmount: '0.18', toAsset: { type: 'FIAT' },
    });
    prisma.internalTransaction.findFirst.mockResolvedValue(null);

    await service.collectSwapFees('swap-1');

    const paths = transfers.createTransfer.mock.calls.map((c: any) => c[0].path);
    expect(paths).toContain('FIAT_FEE_COLLECT');
    expect(paths).toContain('FIAT_SPREAD_COLLECT');
    const feeCall = transfers.createTransfer.mock.calls.find((c: any) => c[0].path === 'FIAT_FEE_COLLECT')[0];
    expect(feeCall.amount.toString()).toBe('0.1');
    expect(feeCall.fromWalletId).toBe('w-C_VIBAN-c1');
    expect(feeCall.toWalletId).toBe('w-F_FEE');
    expect(feeCall.sourceType).toBe('FIAT_FEE_COLLECTION');
    expect(feeCall.sourceId).toBe('swap-1:FEE');
    const spreadCall = transfers.createTransfer.mock.calls.find((c: any) => c[0].path === 'FIAT_SPREAD_COLLECT')[0];
    expect(spreadCall.fromWalletId).toBe('w-F_LIQ');
    expect(spreadCall.toWalletId).toBe('w-F_FEE');
    expect(spreadCall.ownerType).toBe('PLATFORM');
    expect(spreadCall.sourceId).toBe('swap-1:SPREAD');
    expect(fundsFlow.createLeg).toHaveBeenCalledTimes(2);
    expect(accounting.drainFeeReceivableAmount).not.toHaveBeenCalled();
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
});
