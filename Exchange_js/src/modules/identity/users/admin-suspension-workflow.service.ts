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

const SECONDARY_EVENT = 'workflow.admin-suspension.decided';

export interface InitiateSuspensionDto {
  targetUserId: string;
  reason: string;
}

@Injectable()
export class AdminSuspensionWorkflowService {
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

  async initiateSuspension(dto: InitiateSuspensionDto, actor: ApprovalActorContext) {
    // START：本次停用旅程的 correlationId。同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeSuspension 经
    // ApprovalDecidedEvent.traceId INHERIT 读回——与 Task 6 角色变更工作流同款模式。
    const correlationId = randomUUID();

    if (actor.userId === dto.targetUserId) {
      throw new ForbiddenException('Cannot suspend your own account');
    }

    const targetUser = await this.usersDomainService.findById(dto.targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: dto.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN account cannot be suspended');
    }

    if (targetUser.status === 'SUSPENDED') {
      throw new ConflictException('User is already suspended');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
        entityRef: dto.targetUserId,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending suspension approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
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
        action: 'ADMIN_SUSPENSION_REQUESTED',
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
      return this.executeSuspension(event);
    }
  }

  private async executeSuspension(event: ApprovalDecidedEvent) {
    // fromStatus 需要执行前的真实状态快照——suspendUser 只回传执行后的最终状态。
    // findById 是只读方法，符合"workflow 只能通过 domain service 方法接触 Prisma 表"的铁律。
    const before = await this.usersDomainService.findById(event.entityRef);

    try {
      const result = await this.usersDomainService.suspendUser(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: result.userNo,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateSuspension 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: before?.status ?? 'UNKNOWN',
        toStatus: result.status,
        approvalNo: event.approvalNo,
        metadata: {
          approvalId: event.approvalId,
          suspendedByUserId: event.decisionByUserId,
          suspendedByUserNo: event.decisionByUserNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: before?.userNo ?? event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        // fromStatus/toStatus 表达的是这次施加"本该达成的转移意图"，不是"实际达成的结果"——
        // 走到这条分支说明 toStatus=SUSPENDED 没有真正生效，意图仍要如实记录（同角色变更
        // 工作流 beforeData/afterData 的处理原则）。
        fromStatus: before?.status ?? 'UNKNOWN',
        toStatus: 'SUSPENDED',
        approvalNo: event.approvalNo,
        reason: error instanceof Error ? error.message : 'Suspension execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
