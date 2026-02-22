import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';

@Injectable()
export class CustomersService {
  private readonly auditLogsService: AuditLogsService;

  constructor(private prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  async create(data: Prisma.CustomerMainCreateInput): Promise<CustomerMain> {
    const created = await this.prisma.customerMain.create({
      data,
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_CREATE,
      action: AuditActions.CUSTOMER_CREATED,
      module: AuditModules.CUSTOMERS,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: created.id,
      entityNo: created.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: created.id,
      entityOwnerNo: created.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer created',
      afterData: {
        customerType: created.customerType,
        complianceStatus: created.complianceStatus,
      },
      sourcePlatform: 'ADMIN_API',
    });

    return created;
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
    const before = await this.prisma.customerMain.findUnique({ where });
    const updated = await this.prisma.customerMain.update({
      data,
      where,
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_UPDATE,
      action: AuditActions.CUSTOMER_UPDATED,
      module: AuditModules.CUSTOMERS,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: updated.id,
      entityNo: updated.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: updated.id,
      entityOwnerNo: updated.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer updated',
      beforeData: before
        ? {
            customerType: before.customerType,
            complianceStatus: before.complianceStatus,
          }
        : undefined,
      afterData: {
        customerType: updated.customerType,
        complianceStatus: updated.complianceStatus,
      },
      sourcePlatform: 'ADMIN_API',
    });

    return updated;
  }

  async remove(where: Prisma.CustomerMainWhereUniqueInput): Promise<CustomerMain> {
    const before = await this.prisma.customerMain.findUnique({ where });
    const deleted = await this.prisma.customerMain.delete({
      where,
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_DELETE,
      action: AuditActions.CUSTOMER_DELETED,
      module: AuditModules.CUSTOMERS,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: deleted.id,
      entityNo: deleted.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: deleted.id,
      entityOwnerNo: deleted.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer deleted',
      beforeData: before
        ? {
            customerType: before.customerType,
            complianceStatus: before.complianceStatus,
          }
        : undefined,
      sourcePlatform: 'ADMIN_API',
    });

    return deleted;
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
