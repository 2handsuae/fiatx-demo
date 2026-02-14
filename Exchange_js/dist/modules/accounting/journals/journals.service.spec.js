"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const journals_service_1 = require("./journals.service");
describe('JournalsService', () => {
    it('should block imbalanced journal lines by asset', async () => {
        const mockClient = {
            journal: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
            },
            journalHeaderTemplate: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'tpl-1',
                    templateCode: 'TPL_TEST',
                    description: 'test',
                    baseAssetId: 'A1',
                    journalLineTemplates: [
                        {
                            id: 'lt-1',
                            lineNo: 1,
                            accountCode: 'L.CLIENT_CREDIT',
                            drCr: 'DR',
                            amountSource: 'AMOUNT',
                            assetSource: 'ASSET_ID',
                            ownerTypeSource: 'CUSTOMER',
                        },
                        {
                            id: 'lt-2',
                            lineNo: 2,
                            accountCode: 'L.CLIENT_HELD',
                            drCr: 'CR',
                            amountSource: 'AMOUNT',
                            assetSource: 'TO_ASSET_ID',
                            ownerTypeSource: 'CUSTOMER',
                        },
                    ],
                }),
            },
            journalLine: {
                createMany: jest.fn(),
            },
        };
        const service = new journals_service_1.JournalsService({});
        await expect(service.createJournal({
            sourceType: 'DEPOSIT',
            sourceId: 'dep-1',
            eventCode: 'EVT_TEST',
            context: {
                src: {
                    amount: '100',
                    assetId: 'A1',
                    toAssetId: 'A2',
                    ownerId: 'C1',
                    depositNo: 'DEP001',
                },
            },
        }, mockClient)).rejects.toThrow(common_1.BadRequestException);
        expect(mockClient.journal.create).not.toHaveBeenCalled();
    });
    it('should aggregate customer liability balances', async () => {
        const mockPrisma = {
            journalLine: {
                aggregate: jest
                    .fn()
                    .mockResolvedValueOnce({ _sum: { amount: new client_1.Prisma.Decimal(200) } })
                    .mockResolvedValueOnce({ _sum: { amount: new client_1.Prisma.Decimal(80) } })
                    .mockResolvedValueOnce({ _sum: { amount: new client_1.Prisma.Decimal(50) } })
                    .mockResolvedValueOnce({ _sum: { amount: new client_1.Prisma.Decimal(20) } }),
            },
        };
        const service = new journals_service_1.JournalsService(mockPrisma);
        const balances = await service.getCustomerLiabilityBalance({
            ownerId: 'C1',
            assetId: 'A1',
        });
        expect(balances.creditBalance.toString()).toBe('120');
        expect(balances.heldBalance.toString()).toBe('30');
        expect(balances.availableBalance.toString()).toBe('120');
    });
});
//# sourceMappingURL=journals.service.spec.js.map