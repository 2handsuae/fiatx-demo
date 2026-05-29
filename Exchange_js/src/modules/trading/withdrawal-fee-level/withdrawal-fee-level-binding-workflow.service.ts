import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';

@Injectable()
export class WithdrawalFeeLevelBindingWorkflowService {
  private readonly logger = new Logger(WithdrawalFeeLevelBindingWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async bindLevel(
    dto: { customerId: string; levelId: string },
    actor: ApprovalActorContext,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: dto.customerId },
      select: { id: true, customerNo: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);

    const level = await this.feeLevelService.findById(dto.levelId);
    if (level.status !== 'ACTIVE') {
      throw new BadRequestException(`Level ${level.levelCode} is not ACTIVE`);
    }

    const traceId = crypto.randomUUID();

    const binding = await this.bindingService.bind({
      customerId: dto.customerId,
      levelId: dto.levelId,
      boundByUserId: actor.userId,
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_BINDING.LEVEL_BOUND,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        entityId: binding.id,
        entityNo: `${customer.customerNo}:${level.levelCode}`,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          customerId: dto.customerId,
          customerNo: customer.customerNo,
          levelId: dto.levelId,
          levelCode: level.levelCode,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_BOUND_${binding.id}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { bindingId: binding.id, levelCode: level.levelCode, customerNo: customer.customerNo };
  }

  async unbindLevel(
    dto: { customerId: string; levelId: string },
    actor: ApprovalActorContext,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: dto.customerId },
      select: { id: true, customerNo: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);

    const level = await this.feeLevelService.findById(dto.levelId);

    const traceId = crypto.randomUUID();

    const deleted = await this.bindingService.unbind(dto.customerId, dto.levelId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_BINDING.LEVEL_UNBOUND,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        entityId: deleted.id,
        entityNo: `${customer.customerNo}:${level.levelCode}`,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          customerId: dto.customerId,
          customerNo: customer.customerNo,
          levelId: dto.levelId,
          levelCode: level.levelCode,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_UNBOUND_${deleted.id}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { levelCode: level.levelCode, customerNo: customer.customerNo };
  }
}
