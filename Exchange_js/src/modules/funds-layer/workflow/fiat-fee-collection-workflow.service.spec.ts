import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeAccrualService } from '../domain/fee-accrual.service';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

describe('FiatFeeCollectionWorkflowService', () => {
  let service: FiatFeeCollectionWorkflowService;
  let feeAccrual: any, prisma: any;

  beforeEach(async () => {
    feeAccrual = {
      accrueForSwap: jest.fn().mockResolvedValue(undefined),
      accrueForWithdraw: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      withdrawTransaction: { findUnique: jest.fn() },
      feeAccrual: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatFeeCollectionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FeeAccrualService, useValue: feeAccrual },
      ],
    }).compile();

    service = module.get(FiatFeeCollectionWorkflowService);
  });

  describe('onFiatWithdrawalSucceeded', () => {
    it('FIAT withdraw → accrueForWithdraw then settle as WITHDRAW_FEE/FIAT_WITHDRAW (immediate)', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ asset: { type: 'FIAT' } });
      const accruals = [{ id: 'fac-w', assetId: 'a-aed', amount: '5' }];
      prisma.feeAccrual.findMany.mockResolvedValue(accruals);

      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-1' });

      expect(feeAccrual.accrueForWithdraw).toHaveBeenCalledWith('w-1', prisma);
      expect(prisma.feeAccrual.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'WITHDRAW', sourceId: 'w-1', status: 'ACCRUED' },
      });
      expect(feeAccrual.settle).toHaveBeenCalledWith(
        accruals,
        'WITHDRAW_FEE',
        'FIAT_WITHDRAW',
        prisma,
      );
    });

    it('no-op when withdraw asset is not fiat (guard)', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ asset: { type: 'CRYPTO' } });
      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-2' });
      expect(feeAccrual.accrueForWithdraw).not.toHaveBeenCalled();
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });

    it('no settle when there are no ACCRUED rows', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ asset: { type: 'FIAT' } });
      prisma.feeAccrual.findMany.mockResolvedValue([]);
      await service.onFiatWithdrawalSucceeded({ withdrawId: 'w-3' });
      expect(feeAccrual.accrueForWithdraw).toHaveBeenCalledWith('w-3', prisma);
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });
  });
});
