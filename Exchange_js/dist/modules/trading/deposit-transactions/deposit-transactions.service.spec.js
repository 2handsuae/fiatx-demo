"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const deposit_transactions_service_1 = require("./deposit-transactions.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const deposit_transaction_dto_1 = require("./dto/deposit-transaction.dto");
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
describe('DepositTransactionsService', () => {
    let service;
    let prisma;
    let eventEmitter;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                deposit_transactions_service_1.DepositTransactionsService,
                {
                    provide: prisma_service_1.PrismaService,
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
                    provide: event_emitter_1.EventEmitter2,
                    useValue: {
                        emit: jest.fn(),
                    },
                },
            ],
        }).compile();
        service = module.get(deposit_transactions_service_1.DepositTransactionsService);
        prisma = module.get(prisma_service_1.PrismaService);
        eventEmitter = module.get(event_emitter_1.EventEmitter2);
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    describe('updateStatus (State Machine)', () => {
        const mockId = 'uuid';
        const setupMock = (currentStatus) => {
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
            prisma.depositTransaction.findUnique.mockResolvedValue(mockRecord);
            prisma.depositTransaction.update.mockImplementation(({ data }) => Promise.resolve({ ...mockRecord, ...data }));
        };
        it('should transition from PAYIN_PENDING to COMPLIANCE_PENDING via payin_confirmed action', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.PAYIN_CONFIRMED,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: mockId },
                data: expect.objectContaining({ status: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING }),
            }));
        });
        it('should fail invalid transition', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING);
            await expect(service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.SUCCESS,
            })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should transition from COMPLIANCE_PENDING to REJECTED with reason', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING);
            const reason = 'High risk detected';
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.REJECT,
                reason,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: deposit_transaction_dto_1.DepositTransactionStatus.REJECTED,
                }),
            }));
            expect(prisma.depositAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    reason,
                    newStatus: deposit_transaction_dto_1.DepositTransactionStatus.REJECTED,
                }),
            }));
        });
        it('should transition from COMPLIANCE_PENDING to SUCCESS via success', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.SUCCESS,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
                    completedAt: expect.any(Date),
                }),
            }));
        });
        it('should transition from COMPLIANCE_PENDING to UNDER_REVIEW via flag', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.FLAG,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW,
                }),
            }));
        });
        it('should transition from UNDER_REVIEW to SUCCESS via success', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.SUCCESS,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
                }),
            }));
        });
        it('should block SUCCESS when compliance is not cleared', async () => {
            const mockRecord = {
                id: mockId,
                status: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
                ownerType: 'CUSTOMER',
                ownerId: 'U123',
                assetId: 'A123',
                amount: '100',
                payinId: 'P123',
                kytStatus: 'PENDING',
                travelRuleRequired: false,
                travelRuleStatus: 'NOT_REQUIRED',
            };
            prisma.depositTransaction.findUnique.mockResolvedValue(mockRecord);
            await expect(service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.SUCCESS,
            })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should transition from PAYIN_PENDING to FAILED via fail action', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.FAIL,
                reason: 'Network error',
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: deposit_transaction_dto_1.DepositTransactionStatus.FAILED }),
            }));
        });
        it('should transition from COMPLIANCE_PENDING to FAILED via fail action', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.FAIL,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: deposit_transaction_dto_1.DepositTransactionStatus.FAILED }),
            }));
        });
        it('should stay in FAILED status for any action (Terminal)', async () => {
            setupMock(deposit_transaction_dto_1.DepositTransactionStatus.FAILED);
            await service.updateStatus(mockId, {
                action: deposit_transaction_dto_1.DepositTransactionAction.SUCCESS,
            });
            expect(prisma.depositTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: deposit_transaction_dto_1.DepositTransactionStatus.FAILED }),
            }));
        });
    });
});
//# sourceMappingURL=deposit-transactions.service.spec.js.map