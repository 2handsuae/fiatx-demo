import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('DepositTransactionsService', () => {
  let service: DepositTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            depositTransaction: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DepositTransactionsService>(DepositTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should enrich deposit list items with ownerNo and type', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'dep-1',
          depositNo: 'DP001',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          status: DepositTransactionStatus.COMPLIANCE_PENDING,
          amount: '100.00',
          asset: { code: 'USDT', type: 'CRYPTO' },
          customer: { customerNo: 'CU001' },
        },
      ]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        ownerNo: 'CU001',
        type: 'crypto',
      });
    });
  });

  describe('updateStatus (State Machine)', () => {
    const mockId = 'uuid';
    const setupMock = (currentStatus: string) => {
      const mockRecord = {
        id: mockId,
        depositNo: 'DP001',
        status: currentStatus,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ ...mockRecord, ...data }),
      );
    };

    it('PAYIN_PENDING → COMPLIANCE_PENDING via payin_confirmed', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.COMPLIANCE_PENDING }),
        }),
      );
    });

    it('COMPLIANCE_PENDING → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SUCCESS,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('COMPLIANCE_PENDING → REJECTED via reject', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.REJECT,
        reason: 'High risk detected',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.REJECTED,
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('COMPLIANCE_PENDING → ACTION_PENDING via action_pending', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.ACTION_PENDING,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.ACTION_PENDING }),
        }),
      );
    });

    it('ACTION_PENDING → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.SUCCESS }),
        }),
      );
    });

    it('ACTION_PENDING → COMPLIANCE_PENDING via resume', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RESUME,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.COMPLIANCE_PENDING }),
        }),
      );
    });

    it('ACTION_PENDING → EXPIRED via expire', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.EXPIRE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.EXPIRED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('FROZEN → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.SUCCESS }),
        }),
      );
    });

    it('FROZEN → CONFISCATED via confiscate', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.CONFISCATE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.CONFISCATED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('FROZEN rejects invalid actions', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.REJECT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('PAYIN_PENDING → FAILED via fail', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FAIL,
        reason: 'Network error',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.FAILED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws on any action for terminal FAILED', async () => {
      setupMock(DepositTransactionStatus.FAILED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal SUCCESS', async () => {
      setupMock(DepositTransactionStatus.SUCCESS);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal REJECTED', async () => {
      setupMock(DepositTransactionStatus.REJECTED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.FAIL }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid action for PAYIN_PENDING', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByPayinId', () => {
    it('should find deposit by payinId', async () => {
      const mockDeposit = { id: 'dep-1', payinId: 'payin-1' };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockDeposit);

      const result = await service.findByPayinId('payin-1');

      expect(result).toEqual(mockDeposit);
      expect((prisma as any).depositTransaction.findUnique).toHaveBeenCalledWith({
        where: { payinId: 'payin-1' },
      });
    });

    it('should return null if no deposit found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findByPayinId('nonexistent');
      expect(result).toBeNull();
    });
  });
});
