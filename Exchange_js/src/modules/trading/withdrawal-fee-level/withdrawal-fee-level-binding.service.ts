// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class WithdrawalFeeLevelBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCustomer(customerId: string) {
    return this.prisma.withdrawalFeeLevelBinding.findMany({
      where: { customerId },
      include: {
        level: {
          select: { levelCode: true, name: true, assetId: true, status: true, enabled: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByLevel(levelId: string) {
    return this.prisma.withdrawalFeeLevelBinding.findMany({
      where: { levelId },
      include: {
        customer: { select: { customerNo: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async bind(
    dto: { customerId: string; levelId: string; boundByUserId: string },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const existing = await db.withdrawalFeeLevelBinding.findUnique({
      where: { customerId_levelId: { customerId: dto.customerId, levelId: dto.levelId } },
    });
    if (existing) {
      throw new ConflictException('Customer is already bound to this level');
    }

    return db.withdrawalFeeLevelBinding.create({
      data: {
        customerId: dto.customerId,
        levelId: dto.levelId,
        boundByUserId: dto.boundByUserId,
        boundAt: new Date(),
      },
    });
  }

  async unbind(
    customerId: string,
    levelId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const existing = await db.withdrawalFeeLevelBinding.findUnique({
      where: { customerId_levelId: { customerId, levelId } },
    });
    if (!existing) {
      throw new NotFoundException('Binding not found');
    }

    return db.withdrawalFeeLevelBinding.delete({
      where: { customerId_levelId: { customerId, levelId } },
    });
  }

  async findBoundLevelIds(customerId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
    const db = tx ?? this.prisma;
    const bindings = await db.withdrawalFeeLevelBinding.findMany({
      where: { customerId },
      select: { levelId: true },
    });
    return bindings.map((b) => b.levelId);
  }
}
