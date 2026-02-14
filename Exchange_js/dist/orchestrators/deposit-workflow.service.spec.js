"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const deposit_workflow_service_1 = require("./deposit-workflow.service");
const deposit_transaction_dto_1 = require("../modules/trading/deposit-transactions/dto/deposit-transaction.dto");
const payin_dto_1 = require("../modules/asset-treasury/payins/dto/payin.dto");
describe('DepositWorkflowService', () => {
    const mockDepositService = {
        updateStatus: jest.fn(),
        findOne: jest.fn(),
        createFromPayin: jest.fn(),
    };
    const mockJournalsService = {
        triggerEvent: jest.fn(),
        createJournal: jest.fn(),
        reverseJournal: jest.fn(),
    };
    const mockPayinsService = {
        findOne: jest.fn(),
        updateStatus: jest.fn(),
        linkDeposit: jest.fn(),
    };
    const mockEventEmitter = {
        emit: jest.fn(),
    };
    const mockTransactionComplianceService = {
        ensureDepositComplianceCases: jest.fn(),
    };
    const mockTx = {
        depositTransaction: {
            findUnique: jest.fn(),
        },
        payin: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        payinAuditLog: {
            create: jest.fn(),
        },
    };
    const mockPrisma = {
        depositTransaction: {
            findUnique: jest.fn(),
        },
        $transaction: jest.fn(async (callback) => callback(mockTx)),
    };
    let service;
    beforeEach(() => {
        jest.clearAllMocks();
        service = new deposit_workflow_service_1.DepositWorkflowService(mockDepositService, mockJournalsService, mockPayinsService, mockEventEmitter, mockPrisma, mockTransactionComplianceService);
    });
    it('payin confirmed should trigger DEPOSIT COMPLIANCE_PENDING accounting via triggerEvent', async () => {
        mockPrisma.depositTransaction.findUnique.mockResolvedValue({
            id: 'dep-1',
            status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
            ownerType: deposit_transaction_dto_1.DepositOwnerType.CUSTOMER,
            ownerId: 'cust-1',
            assetId: 'asset-1',
            amount: { toString: () => '100.00' },
            depositNo: 'DEP001',
            toWalletId: 'wallet-1',
        });
        mockPayinsService.findOne.mockResolvedValue({
            id: 'payin-1',
            status: payin_dto_1.PayinStatus.CONFIRMED,
            type: 'crypto',
        });
        mockDepositService.updateStatus.mockResolvedValue({
            status: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
        });
        mockJournalsService.triggerEvent.mockResolvedValue({ id: 'je-1' });
        mockPayinsService.updateStatus.mockResolvedValue({ status: payin_dto_1.PayinStatus.CLEARED });
        const result = await service.handlePayinStatusChanged({
            payinId: 'payin-1',
            newStatus: payin_dto_1.PayinStatus.CONFIRMED,
        });
        expect(mockJournalsService.triggerEvent).toHaveBeenCalledTimes(1);
        const [eventParams] = mockJournalsService.triggerEvent.mock.calls[0];
        expect(eventParams).toMatchObject({
            entityType: 'DEPOSIT',
            triggerKey: 'status',
            fromStatus: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
            toStatus: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
            assetType: 'CRYPTO',
            sourceId: 'dep-1',
        });
        expect(mockJournalsService.createJournal).not.toHaveBeenCalled();
        expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
        expect(mockTransactionComplianceService.ensureDepositComplianceCases).toHaveBeenCalledWith('dep-1');
        expect(result?.created_or_reversed_journal_entry_ids).toEqual(['je-1']);
    });
    it('deposit success should trigger DEPOSIT SUCCESS accounting via triggerEvent', async () => {
        mockDepositService.findOne.mockResolvedValue({
            id: 'dep-2',
            status: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
            ownerType: deposit_transaction_dto_1.DepositOwnerType.CUSTOMER,
            ownerId: 'cust-2',
            assetId: 'asset-2',
            amount: { toString: () => '55.50' },
            depositNo: 'DEP002',
            toWalletId: 'wallet-2',
            payinId: 'payin-2',
        });
        mockPayinsService.findOne.mockResolvedValue({
            id: 'payin-2',
            type: 'fiat',
            status: payin_dto_1.PayinStatus.CLEARED,
        });
        mockJournalsService.triggerEvent.mockResolvedValue({ id: 'je-2' });
        await service.handleDepositStatusChanged({
            depositId: 'dep-2',
            oldStatus: deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW,
            newStatus: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
            payinId: 'payin-2',
        });
        expect(mockJournalsService.triggerEvent).toHaveBeenCalledTimes(1);
        const [eventParams] = mockJournalsService.triggerEvent.mock.calls[0];
        expect(eventParams).toMatchObject({
            entityType: 'DEPOSIT',
            triggerKey: 'status',
            fromStatus: deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW,
            toStatus: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
            assetType: 'FIAT',
            sourceId: 'dep-2',
        });
        expect(mockJournalsService.createJournal).not.toHaveBeenCalled();
        expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
    });
    it('deposit rejected should not post accounting but still clear payin', async () => {
        mockTx.depositTransaction.findUnique.mockResolvedValue({
            id: 'dep-3',
            payinId: 'payin-3',
        });
        mockTx.payin.findUnique.mockResolvedValue({
            id: 'payin-3',
            status: payin_dto_1.PayinStatus.CONFIRMED,
            statusHistory: '[]',
        });
        mockTx.payin.update.mockResolvedValue({ status: payin_dto_1.PayinStatus.CLEARED });
        mockTx.payinAuditLog.create.mockResolvedValue({ id: 'audit-1' });
        const result = await service.handleDepositStatusChanged({
            depositId: 'dep-3',
            oldStatus: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
            newStatus: deposit_transaction_dto_1.DepositTransactionStatus.REJECTED,
            payinId: 'payin-3',
        });
        expect(mockPrisma.$transaction).toHaveBeenCalled();
        expect(mockJournalsService.triggerEvent).not.toHaveBeenCalled();
        expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
        expect(mockTx.payin.update).toHaveBeenCalledWith({
            where: { id: 'payin-3' },
            data: expect.objectContaining({
                status: payin_dto_1.PayinStatus.CLEARED,
            }),
        });
        expect(result?.updated_payin_status).toBe(payin_dto_1.PayinStatus.CLEARED);
    });
    it('non-customer deposit should not trigger accounting on payin confirmed', async () => {
        mockPrisma.depositTransaction.findUnique.mockResolvedValue({
            id: 'dep-4',
            status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
            ownerType: deposit_transaction_dto_1.DepositOwnerType.LP,
            ownerId: 'lp-1',
            assetId: 'asset-3',
            amount: { toString: () => '90.00' },
            depositNo: 'DEP004',
            toWalletId: 'wallet-3',
        });
        mockPayinsService.findOne.mockResolvedValue({
            id: 'payin-4',
            status: payin_dto_1.PayinStatus.CONFIRMED,
            type: 'crypto',
        });
        mockDepositService.updateStatus.mockResolvedValue({
            status: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
        });
        mockPayinsService.updateStatus.mockResolvedValue({ status: payin_dto_1.PayinStatus.CLEARED });
        await service.handlePayinStatusChanged({
            payinId: 'payin-4',
            newStatus: payin_dto_1.PayinStatus.CONFIRMED,
        });
        expect(mockJournalsService.triggerEvent).not.toHaveBeenCalled();
        expect(mockTransactionComplianceService.ensureDepositComplianceCases).toHaveBeenCalledWith('dep-4');
    });
});
//# sourceMappingURL=deposit-workflow.service.spec.js.map