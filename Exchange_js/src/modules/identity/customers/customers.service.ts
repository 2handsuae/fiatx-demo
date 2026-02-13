import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerMain, Prisma } from '@prisma/client';
import { NotificationsGateway } from '../../../core/notifications/notifications.gateway';

export enum KycStatus {
  NONE = 'NONE',
  STANDARD_VERIFYING = 'STANDARD_VERIFYING',
  STANDARD_UNDER_REVIEW = 'STANDARD_UNDER_REVIEW',
  STANDARD_REJECTED = 'STANDARD_REJECTED',
  STANDARD_APPROVED = 'STANDARD_APPROVED',
  ENHANCED_VERIFYING = 'ENHANCED_VERIFYING',
  ENHANCED_UNDER_REVIEW = 'ENHANCED_UNDER_REVIEW',
  ENHANCED_REJECTED = 'ENHANCED_REJECTED',
  ENHANCED_APPROVED = 'ENHANCED_APPROVED',
  EXPIRED = 'EXPIRED',
}

export enum AuthLevel {
  NONE = 'NONE',
  STANDARD = 'STANDARD',
  ENHANCED = 'ENHANCED',
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsGateway: NotificationsGateway,
  ) {
    this.logger.log('CustomersService initialized with NotificationsGateway');
  }

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
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id },
      include: {
        kycRecords: {
          orderBy: { createdAt: 'desc' },
        },
        eddRecords: {
          orderBy: { createdAt: 'desc' },
        },
        auditLogs: {
          orderBy: { changedAt: 'desc' },
          take: 20,
        },
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

    if (!customer) return null;

    // Aggregate data for frontend - picking the latest approved or pending records as "active"
    const kycRecords = Array.isArray(customer.kycRecords) ? (customer.kycRecords as any[]) : [];
    const eddRecords = Array.isArray(customer.eddRecords) ? (customer.eddRecords as any[]) : [];
    const activeKyc = kycRecords.find(r => r.status === 'APPROVED') || kycRecords[0] || null;
    const activeEdd = eddRecords.find(r => r.status === 'APPROVED') || eddRecords[0] || null;

    return {
      ...customer,
      activeKyc,
      activeEdd,
    };
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

  async remove(
    where: Prisma.CustomerMainWhereUniqueInput,
  ): Promise<CustomerMain> {
    return this.prisma.customerMain.delete({
      where,
    });
  }

  async changeStatus(
    id: string,
    newStatus: string,
    operatorId: string,
    reason?: string,
  ): Promise<CustomerMain> {
    const customer = await this.findOne(id);
    if (!customer) {
      throw new Error('Customer not found');
    }

    const oldStatus = customer.authStatus;

    // Validate transitions
    const allowedTransitions: Record<string, string[]> = {
      NONE: ['STANDARD_VERIFYING'],
      STANDARD_VERIFYING: ['STANDARD_UNDER_REVIEW'],
      STANDARD_UNDER_REVIEW: [
        'STANDARD_APPROVED',
        'STANDARD_REJECTED',
        'ENHANCED_VERIFYING',
      ],
      STANDARD_REJECTED: ['STANDARD_VERIFYING'],
      STANDARD_APPROVED: ['ENHANCED_VERIFYING', 'EXPIRED'],
      ENHANCED_VERIFYING: ['ENHANCED_UNDER_REVIEW'],
      ENHANCED_UNDER_REVIEW: ['ENHANCED_APPROVED', 'ENHANCED_REJECTED'],
      ENHANCED_REJECTED: ['ENHANCED_VERIFYING'],
      ENHANCED_APPROVED: ['ENHANCED_VERIFYING', 'EXPIRED'],
      EXPIRED: ['STANDARD_VERIFYING'],
    };

    if (!allowedTransitions[oldStatus]?.includes(newStatus)) {
      throw new Error(`Invalid transition from ${oldStatus} to ${newStatus}`);
    }

    // Determine new AuthLevel based on newStatus
    let authLevel = customer.authLevel;
    if (newStatus === 'STANDARD_APPROVED') authLevel = 'STANDARD';
    else if (newStatus === 'ENHANCED_APPROVED') authLevel = 'ENHANCED';
    else if (newStatus === 'EXPIRED') authLevel = 'NONE';
    // If resetting from EXPIRED to NONE, level is already NONE

    // Transaction to update customer and create audit log
    const [updatedCustomer] = await (this.prisma as any).$transaction([
      (this.prisma as any).customerMain.update({
        where: { id },
        data: {
          authStatus: newStatus,
          authLevel: authLevel,
          statusHistory: JSON.stringify([
            ...JSON.parse(customer.statusHistory || '[]'),
            {
              from: oldStatus,
              to: newStatus,
              operatorId,
              reason,
              timestamp: new Date(),
            },
          ]),
        },
      }),
      (this.prisma as any).customerAuditLog.create({
        data: {
          customerId: id,
          operatorId,
          oldStatus,
          newStatus,
          reason,
        },
      }),
    ]);

    // Emit socket event
    this.notificationsGateway.notifyStatusChange(id, newStatus, authLevel);

    return updatedCustomer;
  }
}
