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
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';

describe('DepositTransactionsService', () => {
  let service: DepositTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
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
            complianceAlert: {
              findFirst: jest.fn(),
            },
            complianceIncident: {
              findFirst: jest.fn(),
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
            getTransactionCaseAggregate: jest.fn().mockResolvedValue({
              mainKytCase: null,
              travelRuleCase: null,
              derivedComplianceStatus: 'PENDING',
            }),
            normalizeKytLifecycleStatus: jest.fn((status?: string | null, options?: { allowEmpty?: boolean }) => {
              const normalized = String(status || '').trim().toUpperCase();
              if (!normalized) return options?.allowEmpty ? '' : 'CREATED';
              if (normalized === 'CREATED') return 'CREATED';
              if (['RECEIVED', 'SENT', 'PENDING'].includes(normalized)) return 'RECEIVED';
              return 'FINAL';
            }),
            normalizeTravelRuleLifecycleStatus: jest.fn((
              status?: string | null,
              required?: boolean,
              options?: { allowEmpty?: boolean },
            ) => {
              const normalized = String(status || '').trim().toUpperCase();
              if (!normalized) return options?.allowEmpty ? '' : required ? 'CREATED' : '';
              if (normalized === 'CREATED') return 'CREATED';
              if (['RECEIVED', 'SENT', 'PENDING'].includes(normalized)) return 'RECEIVED';
              return 'FINAL';
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
    ((prisma as any).complianceAlert.findFirst as jest.Mock).mockResolvedValue(null);
    ((prisma as any).complianceIncident.findFirst as jest.Mock).mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should enrich deposit list items with ownerNo, type, and derivedComplianceStatus', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'dep-1',
          depositNo: 'DP001',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          status: DepositTransactionStatus.COMPLIANCE_PENDING,
          amount: '100.00',
          netAmount: '99.00',
          feeAmount: '1.00',
          toWalletId: 'wallet-1',
          fromAddress: null,
          fromIban: null,
          txHash: null,
          referenceNo: null,
          createdAt: new Date('2026-03-28T10:00:00.000Z'),
          updatedAt: new Date('2026-03-28T10:00:00.000Z'),
          completedAt: null,
          asset: {
            code: 'USDT',
            type: 'CRYPTO',
            network: 'TRON',
            decimals: 6,
          },
          customer: {
            customerNo: 'CU001',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            onboardingStatus: 'APPROVED',
            operatingStatus: 'ACTIVE',
            restrictionStatus: 'CLEAR',
            complianceHoldStatus: 'ACTIVE',
          },
        },
      ]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        ownerNo: 'CU001',
        type: 'crypto',
        derivedComplianceStatus: 'PENDING',
      });
    });
  });

  describe('findOne', () => {
    it('should normalize deposit response snapshots to lifecycle values', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-detail-1',
        depositNo: 'DP-DETAIL-1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CU001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        assetId: 'asset-1',
        amount: '100',
        netAmount: '100',
        feeAmount: '0',
        toWalletId: 'wallet-1',
        toWalletNo: 'WA001',
        toAddress: null,
        toIban: null,
        fromWalletId: null,
        fromWalletNo: null,
        fromAddress: null,
        fromIban: null,
        txHash: null,
        confirmations: 0,
        referenceNo: null,
        kytStatus: 'PASS',
        kytScreeningId: null,
        kytRiskScore: null,
        kytCheckedAt: null,
        travelRuleRequired: true,
        travelRuleStatus: 'SENT',
        travelRuleTransferId: null,
        counterpartyVasp: null,
        travelRuleCheckedAt: null,
        createdAt: new Date('2026-03-28T10:00:00.000Z'),
        updatedAt: new Date('2026-03-28T10:00:00.000Z'),
        completedAt: null,
        payinId: null,
        payinNo: null,
        payinStatus: null,
        payinType: null,
        asset: {
          code: 'USDT',
          type: 'CRYPTO',
          network: 'TRON',
          decimals: 6,
        },
        wallet: { walletNo: 'WA001' },
        fromWallet: null,
        payin: null,
        customer: {
          customerNo: 'CU001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'CLEAR',
          complianceHoldStatus: 'ACTIVE',
        },
        auditLogs: [],
      });

      const result = await service.findOne('dep-detail-1');

      expect(result.kytStatus).toBe('FINAL');
      expect(result.travelRuleStatus).toBe('RECEIVED');
    });
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
        kytStatus: 'FINAL',
        travelRuleRequired: false,
        travelRuleStatus: '',
        asset: {
          type: 'CRYPTO',
        },
        customer: {
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'CLEAR',
          complianceHoldStatus: 'ACTIVE',
        },
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

      expect((eventEmitter.emit as jest.Mock).mock.calls.length).toBeGreaterThan(0);
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
        kytStatus: 'CREATED',
        travelRuleRequired: false,
        travelRuleStatus: '',
        asset: {
          type: 'CRYPTO',
        },
        customer: {
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'CLEAR',
          complianceHoldStatus: 'ACTIVE',
        },
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);

      await expect(
        service.updateStatus(mockId, {
          action: DepositTransactionAction.SUCCESS,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow FIAT SUCCESS even when KYT is pending', async () => {
      const mockRecord = {
        id: mockId,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
        kytStatus: 'PENDING',
        travelRuleRequired: true,
        travelRuleStatus: 'PENDING',
        asset: {
          type: 'FIAT',
        },
        customer: {
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'CLEAR',
          complianceHoldStatus: 'ACTIVE',
        },
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        mockRecord,
      );
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        ...mockRecord,
        status: DepositTransactionStatus.SUCCESS,
      });

      await expect(
        service.updateStatus(mockId, {
          action: DepositTransactionAction.SUCCESS,
        }),
      ).resolves.toBeDefined();
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

    it('should block SUCCESS when customer restriction or compliance hold is active', async () => {
      const mockRecord = {
        id: mockId,
        status: DepositTransactionStatus.UNDER_REVIEW,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
        kytStatus: 'FINAL',
        travelRuleRequired: false,
        travelRuleStatus: '',
        asset: {
          type: 'FIAT',
        },
        customer: {
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'RESTRICTED',
          complianceHoldStatus: 'FROZEN',
        },
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        mockRecord,
      );

      await expect(
        service.updateStatus(mockId, {
          action: DepositTransactionAction.SUCCESS,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
