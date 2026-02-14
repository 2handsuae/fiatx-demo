import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.CustomerMainCreateInput): Promise<CustomerMain> {
    return this.prisma.customerMain.create({
      data,
    });
  }

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

  async findOne(id: string): Promise<any> {
    return (this.prisma as any).customerMain.findUnique({
      where: { id },
      include: {
        wallets: {
          include: {
            asset: true,
          },
        },
        corporateProfile: true,
        uboProfiles: {
          orderBy: { createdAt: 'asc' },
        },
        cddCases: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        eddCases: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        onboardingAuditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });
  }

  async update(params: {
    where: Prisma.CustomerMainWhereUniqueInput;
    data: Prisma.CustomerMainUpdateInput;
  }): Promise<CustomerMain> {
    const { where, data } = params;
    return this.prisma.customerMain.update({
      data,
      where,
    });
  }

  async remove(where: Prisma.CustomerMainWhereUniqueInput): Promise<CustomerMain> {
    return this.prisma.customerMain.delete({
      where,
    });
  }

  async changeStatus(
    _id: string,
    _newStatus: string,
    _operatorId: string,
    _reason?: string,
  ): Promise<CustomerMain> {
    throw new BadRequestException(
      'Deprecated endpoint. Use /onboarding/* (customer) and /admin/compliance/* (admin).',
    );
  }
}
