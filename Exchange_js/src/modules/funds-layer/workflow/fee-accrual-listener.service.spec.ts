import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeAccrualService } from '../domain/fee-accrual.service';
import { FeeAccrualListenerService } from './fee-accrual-listener.service';

describe('FeeAccrualListenerService', () => {
  let service: FeeAccrualListenerService;
  let feeAccrual: any, prisma: any;

  beforeEach(async () => {
    feeAccrual = {
      accrueForSwap: jest.fn().mockResolvedValue(undefined),
      accrueForWithdraw: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      withdrawTransaction: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeAccrualListenerService,
        { provide: PrismaService, useValue: prisma },
        { provide: FeeAccrualService, useValue: feeAccrual },
      ],
    }).compile();

    service = module.get(FeeAccrualListenerService);
  });

  describe('onSwapSucceeded', () => {
    it('CRYPTO swap → accrueForSwap(swapId, prisma) (deferred settle)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'CRYPTO' },
      });

      await service.onSwapSucceeded({ swapId: 'swap-1' });

      expect(prisma.swapTransaction.findUnique).toHaveBeenCalledWith({
        where: { id: 'swap-1' },
        select: { toAsset: { select: { type: true } } },
      });
      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-1', prisma);
    });

    it('FIAT swap → NOT accrued here (FiatFeeCollectionWorkflowService owns it)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'FIAT' },
      });

      await service.onSwapSucceeded({ swapId: 'swap-2' });

      expect(feeAccrual.accrueForSwap).not.toHaveBeenCalled();
    });

    it('missing swap → no-op (no throw)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.onSwapSucceeded({ swapId: 'swap-x' }),
      ).resolves.toBeUndefined();
      expect(feeAccrual.accrueForSwap).not.toHaveBeenCalled();
    });

    it('swallows lookup errors (logged, not thrown)', async () => {
      prisma.swapTransaction.findUnique.mockRejectedValue(new Error('db down'));

      await expect(
        service.onSwapSucceeded({ swapId: 'swap-err' }),
      ).resolves.toBeUndefined();
      expect(feeAccrual.accrueForSwap).not.toHaveBeenCalled();
    });
  });

  describe('onCryptoWithdrawalSucceeded', () => {
    it('CRYPTO withdraw → accrueForWithdraw(withdrawId, prisma) (deferred settle)', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        asset: { type: 'CRYPTO' },
      });

      await service.onCryptoWithdrawalSucceeded({ withdrawId: 'w-1' });

      expect(prisma.withdrawTransaction.findUnique).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        select: { asset: { select: { type: true } } },
      });
      expect(feeAccrual.accrueForWithdraw).toHaveBeenCalledWith('w-1', prisma);
    });

    it('FIAT withdraw → NOT accrued here (guard)', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        asset: { type: 'FIAT' },
      });

      await service.onCryptoWithdrawalSucceeded({ withdrawId: 'w-2' });

      expect(feeAccrual.accrueForWithdraw).not.toHaveBeenCalled();
    });

    it('missing withdraw → no-op (no throw)', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.onCryptoWithdrawalSucceeded({ withdrawId: 'w-x' }),
      ).resolves.toBeUndefined();
      expect(feeAccrual.accrueForWithdraw).not.toHaveBeenCalled();
    });

    it('swallows lookup errors (logged, not thrown)', async () => {
      prisma.withdrawTransaction.findUnique.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.onCryptoWithdrawalSucceeded({ withdrawId: 'w-err' }),
      ).resolves.toBeUndefined();
      expect(feeAccrual.accrueForWithdraw).not.toHaveBeenCalled();
    });
  });
});
