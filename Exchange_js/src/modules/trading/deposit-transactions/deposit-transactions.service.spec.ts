import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalTransferService } from '../../funds-layer/domain/internal-transfer.service';

describe('DepositTransactionsService', () => {
  let service: DepositTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      providers: [
        DepositTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            depositTransaction: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
            },
            customerMain: {
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
        {
          provide: InternalTransferService,
          useValue: {
            findFundsOrderBySource: jest.fn().mockResolvedValue([]),
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

    it('blocks ADMIN_API from directly reaching SUCCESS (workflow-only guard)', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await expect(
        service.updateStatus(
          mockId,
          { action: DepositTransactionAction.APPROVE },
          {
            sourcePlatform: 'ADMIN_API',
            actor: { actorType: 'ADMIN', actorId: 'a1' },
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY',
        }),
      });

      expect((prisma as any).depositTransaction.update).not.toHaveBeenCalled();
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
        include: { asset: true },
      });
    });

    it('should return null if no deposit found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findByPayinId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('initializeComplianceGates', () => {
    it('CRYPTO asset → travelRuleRequired true, travelRuleStatus PENDING', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        asset: { type: 'CRYPTO' },
      });
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

      await service.initializeComplianceGates('dep-1');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: {
          travelRuleRequired: true,
          travelRuleStatus: 'PENDING',
        },
      });
    });

    it('FIAT asset → travelRuleRequired false, travelRuleStatus NOT_REQUIRED', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        asset: { type: 'FIAT' },
      });
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

      await service.initializeComplianceGates('dep-1');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: {
          travelRuleRequired: false,
          travelRuleStatus: 'NOT_REQUIRED',
        },
      });
    });
  });

  describe('findOne', () => {
    it('findOne attaches fundsOrders from the 资金单 lookup (sourceType DEPOSIT)', async () => {
      const internalTransferService = module.get<InternalTransferService>(InternalTransferService);
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-detail-1',
        depositNo: 'DP999',
        ownerType: 'CUSTOMER',
        ownerNo: 'CU001',
        asset: { type: 'CRYPTO' },
        wallet: null,
        fromWallet: null,
        payin: null,
        customer: null,
      });
      (internalTransferService.findFundsOrderBySource as jest.Mock).mockResolvedValue([
        { id: 'itx-1', internalTxNo: 'ITX-001', type: 'DEPOSIT', status: 'SUCCESS', legs: [] },
      ]);

      const result = await service.findOne('dep-detail-1');

      expect(internalTransferService.findFundsOrderBySource).toHaveBeenCalledWith(
        'DEPOSIT',
        'dep-detail-1',
      );
      expect(result.fundsOrders).toHaveLength(1);
      expect(result.fundsOrders[0].internalTxNo).toBe('ITX-001');
    });
  });

  describe('Compliance Gate Methods', () => {

    it('updateKytStatus sets kytStatus, riskScore, and checkedAt', async () => {
      const mockRecord = { id: 'dep-1', kytStatus: 'PASSED', kytRiskScore: 15, kytCheckedAt: new Date() };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.updateKytStatus('dep-1', 'PASSED', 15);

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: expect.objectContaining({
          kytStatus: 'PASSED',
          kytRiskScore: 15,
          kytCheckedAt: expect.any(Date),
        }),
      });
      expect(result.kytStatus).toBe('PASSED');
    });

    it('updateTravelRuleStatus sets travelRuleStatus and checkedAt', async () => {
      const mockRecord = { id: 'dep-1', travelRuleStatus: 'PASSED', travelRuleCheckedAt: new Date() };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.updateTravelRuleStatus('dep-1', 'PASSED');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: expect.objectContaining({
          travelRuleStatus: 'PASSED',
          travelRuleCheckedAt: expect.any(Date),
        }),
      });
      expect(result.travelRuleStatus).toBe('PASSED');
    });

    it('getOwnerComplianceStatus returns customer complianceStatus', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'cust-1',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        complianceStatus: 'ACTIVE',
      });

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('ACTIVE');
      expect((prisma as any).depositTransaction.findUnique).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        select: { ownerId: true },
      });
    });

    it('getOwnerComplianceStatus throws if deposit not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOwnerComplianceStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getOwnerComplianceStatus returns UNKNOWN when customer not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'missing-cust',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('UNKNOWN');
    });
  });

});
