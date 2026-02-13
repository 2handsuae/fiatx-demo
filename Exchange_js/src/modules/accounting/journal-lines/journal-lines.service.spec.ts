import { Test, TestingModule } from '@nestjs/testing';
import { JournalLinesService } from './journal-lines.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('JournalLinesService', () => {
  let service: JournalLinesService;
  let prisma: PrismaService;

  const mockPrisma = {
    journalLine: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalLinesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<JournalLinesService>(JournalLinesService);
    prisma = module.get<PrismaService>(PrismaService);
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

      expect(mockPrisma.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'JEL_MATCH' }),
        }),
      );
    });
  });
});
