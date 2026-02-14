"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const payins_service_1 = require("./payins.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const payin_dto_1 = require("./dto/payin.dto");
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
describe('PayinsService', () => {
    let service;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                payins_service_1.PayinsService,
                {
                    provide: prisma_service_1.PrismaService,
                    useValue: {
                        payin: {
                            findMany: jest.fn(),
                            count: jest.fn(),
                            findUnique: jest.fn(),
                            update: jest.fn(),
                            create: jest.fn(),
                        },
                        payinAuditLog: {
                            create: jest.fn(),
                        },
                        wallet: {
                            findUnique: jest.fn(),
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
        service = module.get(payins_service_1.PayinsService);
        prisma = module.get(prisma_service_1.PrismaService);
    });
    describe('updateStatus', () => {
        it('should transition FIAT DETECTED -> CONFIRMED via confirm', async () => {
            const mockPayin = {
                id: '1',
                type: 'fiat',
                status: payin_dto_1.PayinStatus.DETECTED,
                amount: { toString: () => '100' },
                depositId: 'd1',
                assetId: 'a1',
            };
            prisma.payin.findUnique.mockResolvedValue(mockPayin);
            prisma.payin.update.mockResolvedValue({
                ...mockPayin,
                status: payin_dto_1.PayinStatus.CONFIRMED,
            });
            const result = await service.updateStatus('1', payin_dto_1.PayinAction.CONFIRM);
            expect(prisma.payin.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: expect.objectContaining({ status: payin_dto_1.PayinStatus.CONFIRMED }),
            });
            expect(result.status).toBe(payin_dto_1.PayinStatus.CONFIRMED);
        });
        it('should transition CRYPTO DETECTED -> CONFIRMING via block', async () => {
            const mockPayin = {
                id: '2',
                type: 'crypto',
                status: payin_dto_1.PayinStatus.DETECTED,
                amount: { toString: () => '200' },
                depositId: 'd2',
                assetId: 'a2',
            };
            prisma.payin.findUnique.mockResolvedValue(mockPayin);
            prisma.payin.update.mockResolvedValue({
                ...mockPayin,
                status: payin_dto_1.PayinStatus.CONFIRMING,
            });
            const result = await service.updateStatus('2', payin_dto_1.PayinAction.BLOCK);
            expect(prisma.payin.update).toHaveBeenCalledWith({
                where: { id: '2' },
                data: expect.objectContaining({ status: payin_dto_1.PayinStatus.CONFIRMING }),
            });
            expect(result.status).toBe(payin_dto_1.PayinStatus.CONFIRMING);
        });
        it('should transition CRYPTO CONFIRMING -> CONFIRMED via confirm', async () => {
            const mockPayin = {
                id: '2',
                type: 'crypto',
                status: payin_dto_1.PayinStatus.CONFIRMING,
                amount: { toString: () => '200' },
                depositId: 'd2',
                assetId: 'a2',
            };
            prisma.payin.findUnique.mockResolvedValue(mockPayin);
            prisma.payin.update.mockResolvedValue({
                ...mockPayin,
                status: payin_dto_1.PayinStatus.CONFIRMED,
            });
            const result = await service.updateStatus('2', payin_dto_1.PayinAction.CONFIRM);
            expect(prisma.payin.update).toHaveBeenCalledWith({
                where: { id: '2' },
                data: expect.objectContaining({ status: payin_dto_1.PayinStatus.CONFIRMED }),
            });
        });
        it('should throw error for invalid transition', async () => {
            const mockPayin = { id: '1', type: 'fiat', status: payin_dto_1.PayinStatus.DETECTED };
            prisma.payin.findUnique.mockResolvedValue(mockPayin);
            await expect(service.updateStatus('1', payin_dto_1.PayinAction.CLEAR)).rejects.toThrow(common_1.BadRequestException);
        });
    });
});
//# sourceMappingURL=payins.service.spec.js.map