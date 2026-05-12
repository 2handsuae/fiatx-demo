import { Injectable, Logger } from '@nestjs/common';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';

@Injectable()
export class JournalLinesService {
  private readonly logger = new Logger(JournalLinesService.name);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {}

  async findAll(_query: JournalLineQueryDto): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }

  async findOne(_id: string): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }

  async getCustomerBalanceHistory(_query: CustomerBalanceHistoryQueryDto): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }
}
