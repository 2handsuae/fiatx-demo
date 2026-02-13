import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryService } from './treasury.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('TreasuryService', () => {
  let service: TreasuryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryService,
        {
          provide: PrismaService,
          useValue: {
            customerAsset: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<TreasuryService>(TreasuryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
