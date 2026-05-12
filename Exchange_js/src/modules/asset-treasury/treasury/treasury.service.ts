import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

  async getCustomerAssets(_customerId: string): Promise<any> {
    throw new Error(
      'DEPRECATED: migrate to TB — getCustomerAssets reads WalletBalanceSnapshot and JournalLine',
    );
  }
}
