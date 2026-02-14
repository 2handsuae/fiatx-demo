import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';

describe('DepositTransactionsService', () => {
  let service: DepositTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            depositTransaction: {
              findUnique: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            depositAuditLog: {
              create: jest.fn(),
            },
            asset: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: TransactionComplianceService,
          useValue: {
            getCaseSummaries: jest.fn().mockResolvedValue({
              kytCase: null,
              travelRuleCase: null,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DepositTransactionsService>(
      DepositTransactionsService,
    );
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateStatus (State Machine)', () => {
    const mockId = 'uuid';
    const setupMock = (currentStatus: string) => {
      const mockRecord = {
        id: mockId,
        status: currentStatus,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
        kytStatus: 'PASS',
        travelRuleRequired: false,
        travelRuleStatus: 'NOT_REQUIRED',
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementation(({ data }) => 
        Promise.resolve({ ...mockRecord, ...data })
      );
    };

    it('should transition from PAYIN_PENDING to COMPLIANCE_PENDING via payin_confirmed action', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockId },
          data: expect.objectContaining({ status: DepositTransactionStatus.COMPLIANCE_PENDING }),
        }),
      );
    });

    it('should fail invalid transition', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await expect(
        service.updateStatus(mockId, {
          action: DepositTransactionAction.SUCCESS,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transition from COMPLIANCE_PENDING to REJECTED with reason', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      const reason = 'High risk detected';

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.REJECT,
        reason,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.REJECTED,
          }),
        }),
      );

      // Verify audit log includes reason
      expect((prisma as any).depositAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason,
            newStatus: DepositTransactionStatus.REJECTED,
          }),
        }),
      );
    });

    it('should transition from COMPLIANCE_PENDING to SUCCESS via success', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SUCCESS,
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

    it('should transition from COMPLIANCE_PENDING to UNDER_REVIEW via flag', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FLAG,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.UNDER_REVIEW,
          }),
        }),
      );
    });

    it('should transition from UNDER_REVIEW to SUCCESS via success', async () => {
      setupMock(DepositTransactionStatus.UNDER_REVIEW);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SUCCESS,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SUCCESS,
          }),
        }),
      );
    });

    it('should block SUCCESS when compliance is not cleared', async () => {
      const mockRecord = {
        id: mockId,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
        kytStatus: 'PENDING',
        travelRuleRequired: false,
        travelRuleStatus: 'NOT_REQUIRED',
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);

      await expect(
        service.updateStatus(mockId, {
          action: DepositTransactionAction.SUCCESS,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transition from PAYIN_PENDING to FAILED via fail action', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FAIL,
        reason: 'Network error',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.FAILED }),
        }),
      );
    });

    it('should transition from COMPLIANCE_PENDING to FAILED via fail action', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FAIL,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.FAILED }),
        }),
      );
    });

    it('should stay in FAILED status for any action (Terminal)', async () => {
      setupMock(DepositTransactionStatus.FAILED);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SUCCESS,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.FAILED }),
        }),
      );
    });
  });
});
