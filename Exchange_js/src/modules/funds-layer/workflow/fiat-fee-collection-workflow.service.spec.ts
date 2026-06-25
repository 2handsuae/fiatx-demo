import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeAccrualService } from '../domain/fee-accrual.service';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

describe('FiatFeeCollectionWorkflowService', () => {
  let service: FiatFeeCollectionWorkflowService;
  let feeAccrual: any, prisma: any;

  beforeEach(async () => {
    feeAccrual = {
      accrueForWithdraw: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
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
    // neutered in Phase A (real-time inline accounting) — tests updated to match no-op
    it('is a no-op for any event (neutered Phase A)', async () => {
      await expect(
        service.onFiatWithdrawalSucceeded({ withdrawId: 'w-1' }),
      ).resolves.toBeUndefined();

      expect(feeAccrual.accrueForWithdraw).not.toHaveBeenCalled();
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });
  });
});
