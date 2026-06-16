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
      settle: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      withdrawTransaction: { findUnique: jest.fn() },
      feeAccrual: { findMany: jest.fn() },
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
    it('FIAT swap → accrue + immediate settle (SWAP_FEE / FIAT_SWAP)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'FIAT' },
      });
      prisma.feeAccrual.findMany.mockResolvedValue([
        { id: 'fa-1', assetId: 'aed-uuid' },
        { id: 'fa-2', assetId: 'aed-uuid' },
      ]);

      await service.onSwapSucceeded({ swapId: 'swap-2' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-2', prisma);
      expect(prisma.feeAccrual.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'SWAP', sourceId: 'swap-2', status: 'ACCRUED' },
      });
      expect(feeAccrual.settle).toHaveBeenCalledWith(
        [
          { id: 'fa-1', assetId: 'aed-uuid' },
          { id: 'fa-2', assetId: 'aed-uuid' },
        ],
        'SWAP_FEE',
        'FIAT_SWAP',
        prisma,
      );
    });

    it('FIAT swap with zero ACCRUED rows → no settle call', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'FIAT' },
      });
      prisma.feeAccrual.findMany.mockResolvedValue([]);

      await service.onSwapSucceeded({ swapId: 'swap-3' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-3', prisma);
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });

    it('CRYPTO swap → accrueForSwap only, no settle (EOD pass owns settle)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'CRYPTO' },
      });

      await service.onSwapSucceeded({ swapId: 'swap-1' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-1', prisma);
      expect(feeAccrual.settle).not.toHaveBeenCalled();
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
