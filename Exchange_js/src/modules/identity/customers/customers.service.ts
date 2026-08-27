import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

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
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: created.customerNo,
      ownerCustomerNo: created.customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: created.customerNo, subjectRole: 'PRIMARY' as any },
      ],
      outcome: AuditOutcome.SUCCESS,
      reason: 'Customer created',
      requestId: `CUSTOMER_CREATED_${created.customerNo}_${randomUUID()}`,
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
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: updated.customerNo,
      ownerCustomerNo: updated.customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: updated.customerNo, subjectRole: 'PRIMARY' as any },
      ],
      outcome: AuditOutcome.SUCCESS,
      reason: 'Customer updated',
      requestId: `CUSTOMER_UPDATED_${updated.customerNo}_${randomUUID()}`,
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
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: deleted.customerNo,
      ownerCustomerNo: deleted.customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: deleted.customerNo, subjectRole: 'PRIMARY' as any },
      ],
      outcome: AuditOutcome.SUCCESS,
      reason: 'Customer deleted',
      requestId: `CUSTOMER_DELETED_${deleted.customerNo}_${randomUUID()}`,
      sourcePlatform: 'ADMIN_API',
    });

    return deleted;
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
