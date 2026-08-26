import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { UsersDomainService } from './users.domain.service';

const SECONDARY_EVENT = 'workflow.admin-reactivation.decided';

export interface InitiateReactivationDto {
  targetUserId: string;
  reason: string;
}

@Injectable()
export class AdminReactivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async initiateReactivation(dto: InitiateReactivationDto, actor: ApprovalActorContext) {
    // START：本次恢复旅程的 correlationId，同事务写进 ApprovalCase.traceId，
    // 供下游 executeReactivation 经 ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();

    if (actor.userId === dto.targetUserId) {
      throw new ForbiddenException('Cannot reactivate your own account');
    }

    const targetUser = await this.usersDomainService.findById(dto.targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.status !== 'SUSPENDED') {
      throw new ConflictException(`User is not suspended (current status: ${targetUser.status})`);
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: dto.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN account cannot be managed via this workflow');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending reactivation approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        traceId: correlationId,
        objectSnapshot: {
          targetUserId: dto.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
          reason: dto.reason,
        },
      },
      {
        reason: dto.reason,
        traceId: correlationId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_REACTIVATION_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: targetUser.userNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: dto.reason,
        metadata: {
          targetEmail: targetUser.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId: correlationId,
      targetUserNo: targetUser.userNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    // fromStatus 需要执行前的真实状态快照——reactivateUser 只回传执行后的最终状态。
    const before = await this.usersDomainService.findById(event.entityRef);

    try {
      const result = await this.usersDomainService.reactivateUser(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: 'ADMIN_REACTIVATION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: result.userNo,
        // INHERIT：读 ApprovalDecidedEvent.traceId——就是 initiateReactivation 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: before?.status ?? 'UNKNOWN',
        toStatus: result.status,
        approvalNo: event.approvalNo,
        metadata: {
          approvalId: event.approvalId,
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ADMIN_REACTIVATION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: before?.userNo ?? event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        // 同 suspension：fromStatus/toStatus 表达"本该达成的转移意图"，不是"实际结果"。
        fromStatus: before?.status ?? 'UNKNOWN',
        toStatus: 'ACTIVE',
        approvalNo: event.approvalNo,
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
