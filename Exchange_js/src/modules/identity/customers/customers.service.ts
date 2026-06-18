import { Injectable } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

const riskApprovalSummarySelect = {
  id: true,
  approvalNo: true,
  status: true,
} satisfies Prisma.ApprovalCaseSelect;

const customerListInclude = {
  latestRiskApproval: {
    select: riskApprovalSummarySelect,
  },
} satisfies Prisma.CustomerMainInclude;

const customerDetailInclude = {
  corporateProfile: true,
  uboProfiles: {
    orderBy: { createdAt: 'asc' as const },
  },
  latestRiskApproval: {
    select: riskApprovalSummarySelect,
  },
} satisfies Prisma.CustomerMainInclude;

type CustomerListPayload = Prisma.CustomerMainGetPayload<{
  include: typeof customerListInclude;
}>;

type CustomerDetailPayload = Prisma.CustomerMainGetPayload<{
  include: typeof customerDetailInclude;
}>;

type CustomerDetailView = CustomerDetailPayload;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(data: Prisma.CustomerMainCreateInput): Promise<CustomerMain> {
    const created = await this.prisma.customerMain.create({
      data,
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.CUSTOMER_CREATED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: created.id,
      entityNo: created.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: created.id,
      entityOwnerNo: created.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer created',
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
  }): Promise<{ data: CustomerListPayload[]; total: number }> {
    const { skip, take, cursor, where, orderBy } = params;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customerMain.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
        include: customerListInclude,
      }),
      this.prisma.customerMain.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<CustomerDetailView | null> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id },
      include: customerDetailInclude,
    });

    if (!customer) {
      return null;
    }

    return customer;
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
      action: AuditActions.CUSTOMER_UPDATED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: updated.id,
      entityNo: updated.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: updated.id,
      entityOwnerNo: updated.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer updated',
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
      action: AuditActions.CUSTOMER_DELETED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: deleted.id,
      entityNo: deleted.customerNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: deleted.id,
      entityOwnerNo: deleted.customerNo,
      result: AuditResult.SUCCESS,
      reason: 'Customer deleted',
      sourcePlatform: 'ADMIN_API',
    });

    return deleted;
  }
}
