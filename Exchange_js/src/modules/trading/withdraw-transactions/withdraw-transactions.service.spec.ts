import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalsService } from '../../accounting/journals/journals.service';
import { WithdrawTransactionAction } from './dto/withdraw-transaction.dto';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  let prisma: any;
  let journalsService: any;

  const mockTx: any = {
    withdrawTransaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
    withdrawAuditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: any) => cb(mockTx)),
            asset: { findUnique: jest.fn() },
            customerMain: { findUnique: jest.fn() },
            withdrawTransaction: { findUnique: jest.fn() },
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: JournalsService,
          useValue: {
            getCustomerLiabilityBalance: jest.fn(),
            createJournal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    journalsService = module.get<JournalsService>(JournalsService);

    jest.clearAllMocks();
  });

  it('should block create when available balance is insufficient', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001' });
    journalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal(10),
    });

    await expect(
      service.create(
        {
          assetId: 'asset-1',
          amount: 100,
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
  });

  it('should block approve when compliance is not cleared', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      status: 'PENDING_COMPLIANCE',
      complianceStatus: 'PENDING',
      preKytStatus: 'PENDING',
      kytStatus: 'PENDING',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      statusHistory: '[]',
    });

    await expect(
      service.updateStatus('wd-1', {
        action: WithdrawTransactionAction.APPROVE,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
