import { Test, TestingModule } from '@nestjs/testing';
import { JournalLinesService } from './journal-lines.service';

describe('JournalLinesService', () => {
  let service: JournalLinesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JournalLinesService],
    }).compile();

    service = module.get<JournalLinesService>(JournalLinesService);
  });

  it.todo('deprecated — migrate to TB — JournalLine CRUD');
});
