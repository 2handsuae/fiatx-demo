import { Test, TestingModule } from '@nestjs/testing';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { SwapTransactionsService } from './swap-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SwapTransactionStatus,
  SwapTransactionAction,
} from './dto/swap-transaction.dto';
import { SwapEvents } from './constants/swap-events.constant';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JournalsService } from '../../accounting/journals/journals.service';

describe('SwapWorkflowOrchestrator', () => {
  let orchestrator: SwapWorkflowOrchestrator;
  let service: SwapTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  const mockPrisma: any = {
    $transaction: jest.fn((cb) => cb(mockPrisma)),
    swapTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    swapTransactionAuditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockSwapService = {
    generateSwapNo: jest.fn(),
    fetchMarketRate: jest.fn(),
  };

  const mockJournalsService = {
    getCustomerLiabilityBalance: jest.fn(),
    createJournal: jest.fn(),
    triggerEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapWorkflowOrchestrator,
        { provide: SwapTransactionsService, useValue: mockSwapService },
        { provide: JournalsService, useValue: mockJournalsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    orchestrator = module.get<SwapWorkflowOrchestrator>(
      SwapWorkflowOrchestrator,
    );
    service = module.get<SwapTransactionsService>(SwapTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();
  });

  describe('R0: CREATE', () => {
    it('should create a swap and emit CREATED event', async () => {
      const dto = {
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        fromAssetId: 'asset-1',
        fromAmount: 100,
        toAssetId: 'asset-2',
        toAmount: 200,
      };

      const mockTx = {
        id: 'swap-1',
        swapNo: 'SW_1',
        ownerId: 'user-1',
        ownerType: 'CUSTOMER',
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: new Prisma.Decimal(100),
        toAmount: new Prisma.Decimal(200),
        exchangeRate: new Prisma.Decimal(2),
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
      };
      mockPrisma.asset.findUnique.mockResolvedValueOnce({
        id: 'asset-1',
        type: 'CRYPTO',
        code: 'BTC',
      });
      mockPrisma.asset.findUnique.mockResolvedValueOnce({
        id: 'asset-2',
        type: 'CRYPTO',
        code: 'ETH',
      });
      mockSwapService.generateSwapNo.mockResolvedValue('SW_123');
      mockSwapService.fetchMarketRate.mockResolvedValue(new Prisma.Decimal(2));
      mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
        availableBalance: new Prisma.Decimal(1000),
      });
      mockPrisma.swapTransaction.create.mockResolvedValue(mockTx);
      mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
        id: 'log-1',
      });
      mockJournalsService.createJournal.mockResolvedValue({ id: 'JO-1' });

      const result = await orchestrator.createSwap(dto as any);

      expect(result.swap_status_after).toBe(SwapTransactionStatus.PENDING_COMPLIANCE);
      expect(result.emitted_events).toContain(SwapEvents.EVT_SWAP_CREATED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SwapEvents.EVT_SWAP_CREATED,
        { swapId: 'swap-1' },
      );
      expect(mockJournalsService.createJournal).toHaveBeenCalled();
    });

    it('should block create when available balance is insufficient', async () => {
      const dto = {
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        fromAssetId: 'asset-1',
        fromAmount: 100,
        toAssetId: 'asset-2',
        toAmount: 200,
      };

      mockPrisma.asset.findUnique.mockResolvedValueOnce({
        id: 'asset-1',
        type: 'CRYPTO',
        code: 'BTC',
      });
      mockPrisma.asset.findUnique.mockResolvedValueOnce({
        id: 'asset-2',
        type: 'CRYPTO',
        code: 'ETH',
      });
      mockSwapService.fetchMarketRate.mockResolvedValue(new Prisma.Decimal(2));
      mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
        availableBalance: new Prisma.Decimal(10),
      });

      await expect(orchestrator.createSwap(dto as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.swapTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('R1: START_COMPLIANCE', () => {
    it('should transition from CREATED to PENDING_COMPLIANCE', async () => {
      const swapId = 'swap-1';
      const mockTx = { id: swapId, status: SwapTransactionStatus.PENDING_COMPLIANCE };
      mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
      mockPrisma.swapTransaction.update.mockResolvedValue({
        ...mockTx,
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
      });
      mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
        id: 'log-2',
      });

      const result = await orchestrator.handleStatusTransition(
        swapId,
        { action: SwapTransactionAction.FLAG },
        'admin-1',
      );

      expect(result.swap_status_after).toBe(
        SwapTransactionStatus.UNDER_REVIEW,
      );
    });

    it('should throw if invalid transition', async () => {
      const swapId = 'swap-1';
      const mockTx = { id: swapId, status: SwapTransactionStatus.SUCCESS };
      mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);

      await expect(
        orchestrator.handleStatusTransition(
          swapId,
          { action: SwapTransactionAction.FLAG },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('R2: COMPLIANCE_PASS', () => {
    it('should transition to SUCCESS and emit event', async () => {
      const swapId = 'swap-1';
      const mockTx = {
        id: swapId,
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
      };
      mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
      mockPrisma.swapTransaction.update.mockResolvedValue({
        ...mockTx,
        status: SwapTransactionStatus.SUCCESS,
        swapNo: 'SW_1',
        ownerId: 'user-1',
        ownerType: 'CUSTOMER',
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: new Prisma.Decimal(100),
        toAmount: new Prisma.Decimal(200),
        exchangeRate: new Prisma.Decimal(2),
      });
      mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
        id: 'log-3',
      });
      mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue(null);
      mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-2' });

      const result = await orchestrator.handleStatusTransition(
        swapId,
        { action: SwapTransactionAction.SUCCESS },
        'admin-1',
      );

      expect(result.swap_status_after).toBe(SwapTransactionStatus.SUCCESS);
      expect(result.emitted_events).toContain(SwapEvents.EVT_SWAP_SUCCESS);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SwapEvents.EVT_SWAP_SUCCESS,
        { swapId, oldStatus: SwapTransactionStatus.PENDING_COMPLIANCE },
      );
    });

    it('should be idempotent for events', async () => {
      const swapId = 'swap-1';
      const mockTx = {
        id: swapId,
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
      };
      mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
      mockPrisma.swapTransaction.update.mockResolvedValue({
        ...mockTx,
        status: SwapTransactionStatus.SUCCESS,
        swapNo: 'SW_1',
        ownerId: 'user-1',
        ownerType: 'CUSTOMER',
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: new Prisma.Decimal(100),
        toAmount: new Prisma.Decimal(200),
        exchangeRate: new Prisma.Decimal(2),
      });
      mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
        id: 'log-4',
      });
      mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue({
        id: 'log-prev',
      });
      mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-3' });

      const result = await orchestrator.handleStatusTransition(
        swapId,
        { action: SwapTransactionAction.SUCCESS },
        'admin-1',
      );

      expect(result.emitted_events).not.toContain(SwapEvents.EVT_SWAP_SUCCESS);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        SwapEvents.EVT_SWAP_SUCCESS,
        expect.anything(),
      );
    });
  });

  describe('R3: COMPLIANCE_REJECT', () => {
    it('should transition to REJECTED and emit event', async () => {
      const swapId = 'swap-1';
      const mockTx = {
        id: swapId,
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
      };
      mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
      mockPrisma.swapTransaction.update.mockResolvedValue({
        ...mockTx,
        status: SwapTransactionStatus.REJECTED,
        swapNo: 'SW_1',
        ownerId: 'user-1',
        ownerType: 'CUSTOMER',
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: new Prisma.Decimal(100),
        toAmount: new Prisma.Decimal(200),
        exchangeRate: new Prisma.Decimal(2),
      });
      mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
        id: 'log-5',
      });
      mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue(null);
      mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-4' });

      const result = await orchestrator.handleStatusTransition(
        swapId,
        {
          action: SwapTransactionAction.REJECT,
          reason: 'KYC failed',
        },
        'admin-1',
      );

      expect(result.swap_status_after).toBe(SwapTransactionStatus.REJECTED);
      expect(result.emitted_events).toContain(SwapEvents.EVT_SWAP_REJECTED);
    });
  });
});
