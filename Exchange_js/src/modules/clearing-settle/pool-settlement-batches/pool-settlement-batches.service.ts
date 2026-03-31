import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreatePoolSettlementBatchDto,
  PoolSettlementBatchQueryDto,
} from './dto/pool-settlement-batch.dto';

@Injectable()
export class PoolSettlementBatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForAdmin(_query: PoolSettlementBatchQueryDto) {
    throw new Error('PoolSettlementBatchesService.findAllForAdmin is not implemented yet');
  }

  async findDetailForAdmin(_id: string) {
    throw new Error('PoolSettlementBatchesService.findDetailForAdmin is not implemented yet');
  }

  async createBatch(_dto: CreatePoolSettlementBatchDto, _operatorId: string) {
    throw new Error('PoolSettlementBatchesService.createBatch is not implemented yet');
  }

  async submitBatch(_id: string, _operatorId: string) {
    throw new Error('PoolSettlementBatchesService.submitBatch is not implemented yet');
  }
}

