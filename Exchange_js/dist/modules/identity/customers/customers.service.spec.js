"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const customers_service_1 = require("./customers.service");
const mockPrismaService = {
    customerMain: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    $transaction: jest.fn(),
};
describe('CustomersService', () => {
    let service;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                customers_service_1.CustomersService,
                { provide: prisma_service_1.PrismaService, useValue: mockPrismaService },
            ],
        }).compile();
        service = module.get(customers_service_1.CustomersService);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('changeStatus should be deprecated', async () => {
        await expect(service.changeStatus('c1', 'ANY_STATUS', 'op1', 'deprecated test')).rejects.toBeInstanceOf(common_1.BadRequestException);
    });
});
//# sourceMappingURL=customers.service.spec.js.map