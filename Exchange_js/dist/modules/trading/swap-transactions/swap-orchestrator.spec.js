"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const swap_workflow_orchestrator_1 = require("./swap-workflow.orchestrator");
const swap_transactions_service_1 = require("./swap-transactions.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const swap_transaction_dto_1 = require("./dto/swap-transaction.dto");
const swap_events_constant_1 = require("./constants/swap-events.constant");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const journals_service_1 = require("../../accounting/journals/journals.service");
describe('SwapWorkflowOrchestrator', () => {
    let orchestrator;
    let service;
    let prisma;
    let eventEmitter;
    const mockPrisma = {
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
        const module = await testing_1.Test.createTestingModule({
            providers: [
                swap_workflow_orchestrator_1.SwapWorkflowOrchestrator,
                { provide: swap_transactions_service_1.SwapTransactionsService, useValue: mockSwapService },
                { provide: journals_service_1.JournalsService, useValue: mockJournalsService },
                { provide: prisma_service_1.PrismaService, useValue: mockPrisma },
                { provide: event_emitter_1.EventEmitter2, useValue: mockEventEmitter },
            ],
        }).compile();
        orchestrator = module.get(swap_workflow_orchestrator_1.SwapWorkflowOrchestrator);
        service = module.get(swap_transactions_service_1.SwapTransactionsService);
        prisma = module.get(prisma_service_1.PrismaService);
        eventEmitter = module.get(event_emitter_1.EventEmitter2);
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
                fromAmount: new client_1.Prisma.Decimal(100),
                toAmount: new client_1.Prisma.Decimal(200),
                exchangeRate: new client_1.Prisma.Decimal(2),
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
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
            mockSwapService.fetchMarketRate.mockResolvedValue(new client_1.Prisma.Decimal(2));
            mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
                availableBalance: new client_1.Prisma.Decimal(1000),
            });
            mockPrisma.swapTransaction.create.mockResolvedValue(mockTx);
            mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
                id: 'log-1',
            });
            mockJournalsService.createJournal.mockResolvedValue({ id: 'JO-1' });
            const result = await orchestrator.createSwap(dto);
            expect(result.swap_status_after).toBe(swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE);
            expect(result.emitted_events).toContain(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED);
            expect(eventEmitter.emit).toHaveBeenCalledWith(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED, { swapId: 'swap-1' });
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
            mockSwapService.fetchMarketRate.mockResolvedValue(new client_1.Prisma.Decimal(2));
            mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
                availableBalance: new client_1.Prisma.Decimal(10),
            });
            await expect(orchestrator.createSwap(dto)).rejects.toThrow(common_1.BadRequestException);
            expect(mockPrisma.swapTransaction.create).not.toHaveBeenCalled();
        });
    });
    describe('R1: START_COMPLIANCE', () => {
        it('should transition from CREATED to PENDING_COMPLIANCE', async () => {
            const swapId = 'swap-1';
            const mockTx = { id: swapId, status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE };
            mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
            mockPrisma.swapTransaction.update.mockResolvedValue({
                ...mockTx,
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            });
            mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
                id: 'log-2',
            });
            const result = await orchestrator.handleStatusTransition(swapId, { action: swap_transaction_dto_1.SwapTransactionAction.FLAG }, 'admin-1');
            expect(result.swap_status_after).toBe(swap_transaction_dto_1.SwapTransactionStatus.UNDER_REVIEW);
        });
        it('should throw if invalid transition', async () => {
            const swapId = 'swap-1';
            const mockTx = { id: swapId, status: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS };
            mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
            await expect(orchestrator.handleStatusTransition(swapId, { action: swap_transaction_dto_1.SwapTransactionAction.FLAG }, 'admin-1')).rejects.toThrow(common_1.BadRequestException);
        });
    });
    describe('R2: COMPLIANCE_PASS', () => {
        it('should transition to SUCCESS and emit event', async () => {
            const swapId = 'swap-1';
            const mockTx = {
                id: swapId,
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            };
            mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
            mockPrisma.swapTransaction.update.mockResolvedValue({
                ...mockTx,
                status: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS,
                swapNo: 'SW_1',
                ownerId: 'user-1',
                ownerType: 'CUSTOMER',
                fromAssetId: 'asset-1',
                toAssetId: 'asset-2',
                fromAmount: new client_1.Prisma.Decimal(100),
                toAmount: new client_1.Prisma.Decimal(200),
                exchangeRate: new client_1.Prisma.Decimal(2),
            });
            mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
                id: 'log-3',
            });
            mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue(null);
            mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-2' });
            const result = await orchestrator.handleStatusTransition(swapId, { action: swap_transaction_dto_1.SwapTransactionAction.SUCCESS }, 'admin-1');
            expect(result.swap_status_after).toBe(swap_transaction_dto_1.SwapTransactionStatus.SUCCESS);
            expect(result.emitted_events).toContain(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS);
            expect(eventEmitter.emit).toHaveBeenCalledWith(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS, { swapId, oldStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE });
        });
        it('should be idempotent for events', async () => {
            const swapId = 'swap-1';
            const mockTx = {
                id: swapId,
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            };
            mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
            mockPrisma.swapTransaction.update.mockResolvedValue({
                ...mockTx,
                status: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS,
                swapNo: 'SW_1',
                ownerId: 'user-1',
                ownerType: 'CUSTOMER',
                fromAssetId: 'asset-1',
                toAssetId: 'asset-2',
                fromAmount: new client_1.Prisma.Decimal(100),
                toAmount: new client_1.Prisma.Decimal(200),
                exchangeRate: new client_1.Prisma.Decimal(2),
            });
            mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
                id: 'log-4',
            });
            mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue({
                id: 'log-prev',
            });
            mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-3' });
            const result = await orchestrator.handleStatusTransition(swapId, { action: swap_transaction_dto_1.SwapTransactionAction.SUCCESS }, 'admin-1');
            expect(result.emitted_events).not.toContain(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS);
            expect(eventEmitter.emit).not.toHaveBeenCalledWith(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS, expect.anything());
        });
    });
    describe('R3: COMPLIANCE_REJECT', () => {
        it('should transition to REJECTED and emit event', async () => {
            const swapId = 'swap-1';
            const mockTx = {
                id: swapId,
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            };
            mockPrisma.swapTransaction.findUnique.mockResolvedValue(mockTx);
            mockPrisma.swapTransaction.update.mockResolvedValue({
                ...mockTx,
                status: swap_transaction_dto_1.SwapTransactionStatus.REJECTED,
                swapNo: 'SW_1',
                ownerId: 'user-1',
                ownerType: 'CUSTOMER',
                fromAssetId: 'asset-1',
                toAssetId: 'asset-2',
                fromAmount: new client_1.Prisma.Decimal(100),
                toAmount: new client_1.Prisma.Decimal(200),
                exchangeRate: new client_1.Prisma.Decimal(2),
            });
            mockPrisma.swapTransactionAuditLog.create.mockResolvedValue({
                id: 'log-5',
            });
            mockPrisma.swapTransactionAuditLog.findFirst.mockResolvedValue(null);
            mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JO-4' });
            const result = await orchestrator.handleStatusTransition(swapId, {
                action: swap_transaction_dto_1.SwapTransactionAction.REJECT,
                reason: 'KYC failed',
            }, 'admin-1');
            expect(result.swap_status_after).toBe(swap_transaction_dto_1.SwapTransactionStatus.REJECTED);
            expect(result.emitted_events).toContain(swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED);
        });
    });
});
//# sourceMappingURL=swap-orchestrator.spec.js.map