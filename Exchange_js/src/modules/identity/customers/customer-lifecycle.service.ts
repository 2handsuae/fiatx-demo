import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CustomerLifecycle,
  CustomerLifecycleAction,
  nextLifecycle,
} from '../constants/customer-lifecycle.constant';

/**
 * 生命周期主体服务——lifecycle 的唯一写入口（铁律④）。
 * 波二接驱动：所有迁移经 nextLifecycle() 沿边走；REAPPLY 守卫与
 * onboardingApprovedAt「仅 null 时落值」纪律（spec §2）都收口在这。
 */
@Injectable()
export class CustomerLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async applyAction(
    customerId: string,
    action: CustomerLifecycleAction,
    tx?: Prisma.TransactionClient,
  ): Promise<{ from: CustomerLifecycle; to: CustomerLifecycle }> {
    const db = tx ?? this.prisma;
    const c = await db.customerMain.findUnique({
      where: { id: customerId },
      select: { lifecycle: true, onboardingApprovedAt: true, onboardingFinalRejectedAt: true },
    });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (action === 'REAPPLY' && c.onboardingFinalRejectedAt) {
      throw new BadRequestException('Final rejection on record: reapply is not allowed');
    }
    const from = c.lifecycle as CustomerLifecycle;
    const to = nextLifecycle(from, action); // 非法边在这显式抛
    const data: Prisma.CustomerMainUpdateInput = { lifecycle: to };
    if (to === 'ACTIVE' && !c.onboardingApprovedAt) data.onboardingApprovedAt = new Date();
    await db.customerMain.update({ where: { id: customerId }, data });
    return { from, to };
  }
}
