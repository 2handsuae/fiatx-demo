"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
jest.mock('uuid', () => ({
    v4: () => 'mock-uuid',
}));
const withdraw_workflow_orchestrator_1 = require("./withdraw-workflow.orchestrator");
const withdraw_transactions_service_1 = require("../modules/trading/withdraw-transactions/withdraw-transactions.service");
const payouts_service_1 = require("../modules/asset-treasury/payouts/payouts.service");
const journals_service_1 = require("../modules/accounting/journals/journals.service");
const clearings_service_1 = require("../modules/clearing-settle/clearing/clearings.service");
const prisma_service_1 = require("../core/prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const withdraw_transaction_dto_1 = require("../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto");
const payout_dto_1 = require("../modules/asset-treasury/payouts/dto/payout.dto");
const client_1 = require("@prisma/client");
describe('WithdrawWorkflowOrchestrator', () => {
    let orchestrator;
    let withdrawalService;
    let payoutsService;
    let journalsService;
    let prisma;
    const mockPrisma = {
        $transaction: jest.fn((cb) => cb(mockPrisma)),
        withdrawAuditLog: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
    };
    const mockWithdrawalService = {
        findOne: jest.fn(),
        updateStatus: jest.fn(),
    };
    const mockPayoutsService = {
        updateStatus: jest.fn(),
    };
    const mockJournalsService = {
        triggerEvent: jest.fn(),
    };
    const mockClearingsService = {
        triggerClearing: jest.fn(),
    };
    const mockEventEmitter = {
        emit: jest.fn(),
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                withdraw_workflow_orchestrator_1.WithdrawWorkflowOrchestrator,
                { provide: withdraw_transactions_service_1.WithdrawTransactionsService, useValue: mockWithdrawalService },
                { provide: payouts_service_1.PayoutsService, useValue: mockPayoutsService },
                { provide: journals_service_1.JournalsService, useValue: mockJournalsService },
                { provide: clearings_service_1.ClearingsService, useValue: mockClearingsService },
                { provide: prisma_service_1.PrismaService, useValue: mockPrisma },
                { provide: event_emitter_1.EventEmitter2, useValue: mockEventEmitter },
            ],
        }).compile();
        orchestrator = module.get(withdraw_workflow_orchestrator_1.WithdrawWorkflowOrchestrator);
        withdrawalService = module.get(withdraw_transactions_service_1.WithdrawTransactionsService);
        payoutsService = module.get(payouts_service_1.PayoutsService);
        journalsService = module.get(journals_service_1.JournalsService);
        prisma = module.get(prisma_service_1.PrismaService);
        jest.clearAllMocks();
    });
    describe('onPayoutConfirmed (Atomic Success Path)', () => {
        it('should execute the atomic success path correctly', async () => {
            const withdrawId = 'WDR-123';
            const payoutId = 'PO-456';
            const mockWithdrawal = {
                id: withdrawId,
                status: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
                ownerType: 'CUSTOMER',
                type: 'crypto',
                amount: new client_1.Prisma.Decimal(100),
                netAmount: new client_1.Prisma.Decimal(99),
                feeAmount: new client_1.Prisma.Decimal(1),
            };
            mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
            mockWithdrawalService.findOne.mockResolvedValue(mockWithdrawal);
            mockWithdrawalService.updateStatus.mockResolvedValue({ ...mockWithdrawal, status: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS });
            mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE-789' });
            mockPayoutsService.updateStatus.mockResolvedValue({ id: payoutId, status: payout_dto_1.PayoutStatus.CLEAR });
            mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG-999' });
            const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });
            expect(prisma.$transaction).toHaveBeenCalled();
            expect(mockWithdrawalService.updateStatus).toHaveBeenCalledWith(withdrawId, expect.objectContaining({ action: 'success' }), mockPrisma);
            expect(mockJournalsService.triggerEvent).toHaveBeenCalledWith(expect.objectContaining({ toStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS }), mockPrisma);
            expect(mockPayoutsService.updateStatus).toHaveBeenCalledWith(payoutId, expect.objectContaining({ action: 'CLEAR' }), 'SYSTEM', mockPrisma);
            expect(mockPrisma.withdrawAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    newStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS,
                    reason: expect.stringContaining('SUCCESS_PATH_ATOMIC'),
                }),
            }));
            expect(result?.updated_withdrawal_status).toBe(withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS);
            expect(result?.updated_payout_status).toBe(payout_dto_1.PayoutStatus.CLEAR);
        });
        it('should be idempotent and skip if already processed', async () => {
            const withdrawId = 'WDR-123';
            const payoutId = 'PO-456';
            mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue({ id: 'LOG-EXISTING' });
            const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });
            expect(result).toBeNull();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
        it('should skip if withdrawal is not in PAYOUT_PENDING', async () => {
            const withdrawId = 'WDR-123';
            const payoutId = 'PO-456';
            const mockWithdrawal = {
                id: withdrawId,
                status: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
            };
            mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
            mockWithdrawalService.findOne.mockResolvedValue(mockWithdrawal);
            const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });
            expect(result).toBeNull();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=withdraw-workflow.orchestrator.spec.js.map