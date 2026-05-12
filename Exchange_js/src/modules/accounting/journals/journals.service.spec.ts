import { Test, TestingModule } from '@nestjs/testing';
import { JournalsService } from './journals.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('JournalsService', () => {
  let service: JournalsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalsService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<JournalsService>(JournalsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('deprecated — migrate to TB — createJournal writes JournalLine rows');
  it.todo('deprecated — migrate to TB — reverseJournal writes JournalLine rows');
  it.todo('deprecated — migrate to TB — reverseAllBySource writes JournalLine rows');
  it.todo('deprecated — migrate to TB — getCustomerLiabilityBalance via JournalLine aggregation');
});
