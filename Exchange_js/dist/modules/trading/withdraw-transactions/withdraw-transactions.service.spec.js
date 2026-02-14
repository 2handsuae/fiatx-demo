"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const event_emitter_1 = require("@nestjs/event-emitter");
const withdraw_transactions_service_1 = require("./withdraw-transactions.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const journals_service_1 = require("../../accounting/journals/journals.service");
const withdraw_transaction_dto_1 = require("./dto/withdraw-transaction.dto");
const transaction_compliance_service_1 = require("../../risk-engine/transaction-compliance/transaction-compliance.service");
describe('WithdrawTransactionsService', () => {
    let service;
    let prisma;
    let journalsService;
    let transactionComplianceService;
    const mockTx = {
        withdrawTransaction: {
            create: jest.fn(),
            update: jest.fn(),
            findUnique: jest.fn(),
        },
        withdrawAuditLog: {
            create: jest.fn(),
        },
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                withdraw_transactions_service_1.WithdrawTransactionsService,
                {
                    provide: prisma_service_1.PrismaService,
                    useValue: {
                        $transaction: jest.fn((cb) => cb(mockTx)),
                        asset: { findUnique: jest.fn() },
                        customerMain: { findUnique: jest.fn() },
                        withdrawTransaction: { findUnique: jest.fn() },
                    },
                },
                {
                    provide: event_emitter_1.EventEmitter2,
                    useValue: { emit: jest.fn() },
                },
                {
                    provide: journals_service_1.JournalsService,
                    useValue: {
                        getCustomerLiabilityBalance: jest.fn(),
                        createJournal: jest.fn(),
                    },
                },
                {
                    provide: transaction_compliance_service_1.TransactionComplianceService,
                    useValue: {
                        ensureWithdrawComplianceCases: jest.fn(),
                        getCaseSummaries: jest.fn(),
                    },
                },
            ],
        }).compile();
        service = module.get(withdraw_transactions_service_1.WithdrawTransactionsService);
        prisma = module.get(prisma_service_1.PrismaService);
        journalsService = module.get(journals_service_1.JournalsService);
        transactionComplianceService = module.get(transaction_compliance_service_1.TransactionComplianceService);
        jest.clearAllMocks();
        transactionComplianceService.getCaseSummaries.mockResolvedValue({
            kytCase: null,
            travelRuleCase: null,
        });
    });
    it('should block create when available balance is insufficient', async () => {
        prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
        prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001' });
        journalsService.getCustomerLiabilityBalance.mockResolvedValue({
            availableBalance: new client_1.Prisma.Decimal(10),
        });
        await expect(service.create({
            assetId: 'asset-1',
            amount: 100,
        }, 'user-1')).rejects.toThrow(common_1.BadRequestException);
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
        await expect(service.updateStatus('wd-1', {
            action: withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE,
        })).rejects.toThrow(common_1.BadRequestException);
    });
    it('should trigger compliance case setup when moving to PENDING_COMPLIANCE', async () => {
        prisma.withdrawTransaction.findUnique.mockResolvedValue({
            id: 'wd-2',
            status: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
            ownerType: 'CUSTOMER',
            ownerId: 'cust-1',
            assetId: 'asset-1',
            type: 'crypto',
            amount: new client_1.Prisma.Decimal(100),
            netAmount: new client_1.Prisma.Decimal(100),
            feeAmount: new client_1.Prisma.Decimal(0),
            withdrawNo: 'WD0002',
            travelRuleRequired: false,
            statusHistory: '[]',
            auditLogs: [],
            payout: null,
            customer: null,
            asset: null,
        });
        mockTx.withdrawTransaction.update.mockResolvedValue({
            id: 'wd-2',
            status: withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE,
            type: 'crypto',
            travelRuleRequired: false,
            travelRuleStatus: 'NOT_REQUIRED',
            complianceStatus: 'CLEAR',
            preKytStatus: 'PASS',
            kytStatus: 'PASS',
        });
        mockTx.withdrawAuditLog.create.mockResolvedValue({ id: 'audit-2' });
        mockTx.withdrawTransaction.findUnique.mockResolvedValue({
            id: 'wd-2',
            status: withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE,
            type: 'crypto',
            travelRuleRequired: false,
            travelRuleStatus: 'NOT_REQUIRED',
            complianceStatus: 'CLEAR',
            preKytStatus: 'PASS',
            kytStatus: 'PASS',
        });
        transactionComplianceService.ensureWithdrawComplianceCases.mockResolvedValue({});
        const result = await service.updateStatus('wd-2', {
            action: withdraw_transaction_dto_1.WithdrawTransactionAction.CHECK,
        });
        expect(transactionComplianceService.ensureWithdrawComplianceCases).toHaveBeenCalledWith('wd-2', mockTx);
        expect(result.status).toBe(withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE);
    });
});
//# sourceMappingURL=withdraw-transactions.service.spec.js.map