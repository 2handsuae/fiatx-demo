import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { isStaticTag, isValidTag, NEW_CUSTOMER_DAYS } from './constants/customer-tag.constant';

@Injectable()
export class CustomerTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  private assertStaticTag(tagCode: string) {
    if (!isValidTag(tagCode)) {
      throw new BadRequestException(`Tag ${tagCode} 未注册`);
    }
    if (!isStaticTag(tagCode)) {
      throw new BadRequestException(`Tag ${tagCode} 不是可手动赋的 STATIC 标签`);
    }
  }

  async assign(customerId: string, tagCode: string, actor: ApprovalActorContext) {
    this.assertStaticTag(tagCode);
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { customerNo: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const row = await this.prisma.customerExplicitTag.upsert({
      where: { customerId_tagCode: { customerId, tagCode } },
      update: {},
      create: { customerId, tagCode, assignedByUserId: actor.userId },
    });

    await this.audit.recordByActor(
      {
        action: 'CUSTOMER_TAG_ASSIGNED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.CUSTOMER_TAG,
        primarySubjectNo: `${customer.customerNo}:${tagCode}`,
        outcome: AuditOutcome.SUCCESS,
        afterData: { tagCode },
        metadata: { customerId, tagCode },
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return row;
  }

  async revoke(customerId: string, tagCode: string, reason: string, actor: ApprovalActorContext) {
    this.assertStaticTag(tagCode);
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { customerNo: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const row = await this.prisma.customerExplicitTag.delete({
      where: { customerId_tagCode: { customerId, tagCode } },
    });

    await this.audit.recordByActor(
      {
        action: 'CUSTOMER_TAG_REVOKED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.CUSTOMER_TAG,
        primarySubjectNo: `${customer.customerNo}:${tagCode}`,
        outcome: AuditOutcome.SUCCESS,
        reason,
        beforeData: { tagCode },
        metadata: { customerId, tagCode },
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return row;
  }

  async effectiveTags(customerId: string, now: Date): Promise<Set<string>> {
    const [explicit, c] = await Promise.all([
      this.prisma.customerExplicitTag.findMany({ where: { customerId }, select: { tagCode: true } }),
      this.prisma.customerMain.findUnique({
        where: { id: customerId },
        select: { onboardingApprovedAt: true },
      }),
    ]);

    const tags = new Set<string>(explicit.map((e: any) => e.tagCode));
    if (
      c?.onboardingApprovedAt &&
      now.getTime() - c.onboardingApprovedAt.getTime() <= NEW_CUSTOMER_DAYS * 86_400_000
    ) {
      tags.add('NEW_CUSTOMER');
    }
    return tags;
  }
}
