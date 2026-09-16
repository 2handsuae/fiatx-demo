import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.CustomerMainWhereUniqueInput;
    where?: Prisma.CustomerMainWhereInput;
    orderBy?: Prisma.CustomerMainOrderByWithRelationInput;
  }): Promise<{ data: CustomerMain[]; total: number }> {
    const { skip, take, cursor, where, orderBy } = params;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customerMain.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      }),
      this.prisma.customerMain.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<CustomerMain | null> {
    return this.prisma.customerMain.findUnique({
      where: { id },
    });
  }

  /** 铁律⑥ 对外用业务键：controller 用它把路由上的 customerNo 换回内部 id。 */
  async findByCustomerNo(customerNo: string): Promise<CustomerMain | null> {
    return this.prisma.customerMain.findUnique({
      where: { customerNo },
    });
  }

  /** 入驻实体字段的唯一显式写方法（波二）。workflow 不直写表（铁律③）。 */
  async updateOnboardingData(
    customerId: string,
    data: Partial<{
      firstName: string; lastName: string;
      dateOfBirth: string; nationality: string; idDocType: string;
      idDocNumber: string; residentialAddress: string;
      onboardingSubmittedAt: Date | null;
      onboardingFinalRejectedAt: Date | null;
      eddRequired: boolean;
      sumsubApplicantId: string;
      sumsubCurrentLevelName: string;
    }>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = (tx ?? this.prisma) as PrismaService;
    return db.customerMain.update({ where: { id: customerId }, data });
  }

  /**
   * 2026-08-17 材料请求账（Task 12）：从已删除的客户级补料 service 搬来。
   * 这个客户是否曾被任意一笔兑换硬线处置过。一旦为真，后续软线裁决不再
   * 暴露补料入口。
   */
  async hasHardLineDisposition(customerId: string): Promise<boolean> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    return !!c?.hardLineDispositionedAt;
  }

  /** 档位唯一运行时写口（波三 spec §6）：只许 BASIC→PREMIUM，一切经升级申请单裁决处理器。 */
  async applyTierUpgrade(customerId: string, tx?: Prisma.TransactionClient): Promise<{ fromTier: 'BASIC'; toTier: 'PREMIUM' }> {
    const db = tx ?? this.prisma;
    const c = await db.customerMain.findUnique({ where: { id: customerId }, select: { tradingTier: true } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (c.tradingTier !== 'BASIC') throw new BadRequestException(`Tier transition not allowed: ${c.tradingTier} -> PREMIUM`);
    await db.customerMain.update({ where: { id: customerId }, data: { tradingTier: 'PREMIUM' } });
    return { fromTier: 'BASIC', toTier: 'PREMIUM' };
  }

  /** 盖 sticky 硬线章。只在命中制裁时盖 —— 「无 action 的硬线」不该造成永久沉默。 */
  async markHardLineDisposition(customerId: string): Promise<void> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    if (c?.hardLineDispositionedAt) return;
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { hardLineDispositionedAt: new Date() },
    });
  }
}
