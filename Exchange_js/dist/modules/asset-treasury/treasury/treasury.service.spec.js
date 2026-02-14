"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const treasury_service_1 = require("./treasury.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
describe('TreasuryService', () => {
    let service;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                treasury_service_1.TreasuryService,
                {
                    provide: prisma_service_1.PrismaService,
                    useValue: {
                        customerAsset: {
                            findMany: jest.fn(),
                        },
                    },
                },
            ],
        }).compile();
        service = module.get(treasury_service_1.TreasuryService);
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
//# sourceMappingURL=treasury.service.spec.js.map