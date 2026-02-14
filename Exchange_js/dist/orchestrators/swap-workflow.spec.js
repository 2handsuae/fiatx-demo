"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const swap_workflow_service_1 = require("./swap-workflow.service");
const swap_transactions_service_1 = require("../modules/trading/swap-transactions/swap-transactions.service");
const journals_service_1 = require("../modules/accounting/journals/journals.service");
const swap_transaction_dto_1 = require("../modules/trading/swap-transactions/dto/swap-transaction.dto");
describe('SwapWorkflowService', () => {
    let service;
    let swapService;
    let journalService;
    const mockSwap = {
        id: 'swap-123',
        swapNo: 'SW_20240127_000001',
        ownerId: 'user-1',
        ownerType: 'CUSTOMER',
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: { toString: () => '100' },
        toAmount: { toString: () => '200' },
        exchangeRate: { toString: () => '2' },
    };
    const mockSwapService = {
        findOne: jest.fn().mockResolvedValue(mockSwap),
    };
    const mockJournalService = {
        triggerEvent: jest.fn().mockResolvedValue({ id: 'journal-1' }),
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                swap_workflow_service_1.SwapWorkflowService,
                { provide: swap_transactions_service_1.SwapTransactionsService, useValue: mockSwapService },
                { provide: journals_service_1.JournalsService, useValue: mockJournalService },
            ],
        }).compile();
        service = module.get(swap_workflow_service_1.SwapWorkflowService);
        swapService = module.get(swap_transactions_service_1.SwapTransactionsService);
        journalService = module.get(journals_service_1.JournalsService);
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('should trigger accounting on EVT_SWAP_CREATED', async () => {
        await service.handleSwapCreated({ swapId: 'swap-123' });
        expect(swapService.findOne).toHaveBeenCalledWith('swap-123');
        expect(journalService.triggerEvent).toHaveBeenCalledWith(expect.objectContaining({
            entityType: 'SWAP',
            toStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            sourceId: 'swap-123',
        }));
    });
    it('should trigger accounting on EVT_SWAP_SUCCESS', async () => {
        await service.handleSwapSuccess({
            swapId: 'swap-123',
            oldStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
        });
        expect(journalService.triggerEvent).toHaveBeenCalledWith(expect.objectContaining({
            entityType: 'SWAP',
            fromStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            toStatus: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS,
        }));
    });
    it('should trigger accounting on EVT_SWAP_REJECTED', async () => {
        await service.handleSwapRejected({
            swapId: 'swap-123',
            oldStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            reason: 'test',
        });
        expect(journalService.triggerEvent).toHaveBeenCalledWith(expect.objectContaining({
            entityType: 'SWAP',
            fromStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
            toStatus: swap_transaction_dto_1.SwapTransactionStatus.REJECTED,
        }));
    });
});
//# sourceMappingURL=swap-workflow.spec.js.map