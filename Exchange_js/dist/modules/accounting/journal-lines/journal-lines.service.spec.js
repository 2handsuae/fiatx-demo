"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const journal_lines_service_1 = require("./journal-lines.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
describe('JournalLinesService', () => {
    let service;
    let prisma;
    const mockPrisma = {
        journalLine: {
            findMany: jest.fn(),
            count: jest.fn(),
            findUnique: jest.fn(),
        },
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                journal_lines_service_1.JournalLinesService,
                { provide: prisma_service_1.PrismaService, useValue: mockPrisma },
            ],
        }).compile();
        service = module.get(journal_lines_service_1.JournalLinesService);
        prisma = module.get(prisma_service_1.PrismaService);
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    describe('findAll', () => {
        it('should return paginated journal lines', async () => {
            const mockLines = [
                {
                    id: 'JEL_1',
                    dimensions: '{}',
                    journal: { eventCode: 'E1' },
                    account: { name: 'A1' },
                    asset: { code: 'USD' },
                },
            ];
            mockPrisma.journalLine.findMany.mockResolvedValue(mockLines);
            mockPrisma.journalLine.count.mockResolvedValue(1);
            const result = await service.findAll({ skip: '0', take: '10' });
            expect(result.items).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('JEL_1');
        });
        it('should filter by exact id', async () => {
            const mockLines = [
                {
                    id: 'JEL_MATCH',
                    dimensions: '{}',
                    journal: { eventCode: 'E1' },
                    account: { name: 'A1' },
                    asset: { code: 'USD' },
                },
            ];
            mockPrisma.journalLine.findMany.mockResolvedValue(mockLines);
            mockPrisma.journalLine.count.mockResolvedValue(1);
            await service.findAll({ id: 'JEL_MATCH' });
            expect(mockPrisma.journalLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: 'JEL_MATCH' }),
            }));
        });
    });
});
//# sourceMappingURL=journal-lines.service.spec.js.map