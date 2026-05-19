import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AccessControlService } from '../access-control/access-control.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { UsersDomainService } from './users.domain.service';

const SECONDARY_EVENT = 'workflow.admin-invite.decided';

export interface InitiateAdminInviteDto {
  email: string;
  roleCodes: string[];
  changeReason?: string;
}

@Injectable()
export class AdminInviteWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly accessControlService: AccessControlService,
    private readonly approvalsService: ApprovalsService,
    private readonly adminInvitationsService: AdminInvitationsService,
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

  async initiateInvite(dto: InitiateAdminInviteDto, actor: ApprovalActorContext) {
    const traceId = randomUUID();
    const roleCodes = dto.roleCodes;

    const user = await this.usersDomainService.createProvisionalUser({
      email: dto.email,
      roleCodes,
    });

    let approvalCase: any = null;
    try {
      await this.accessControlService.replaceUserRoles(
        user.id,
        roleCodes,
        { actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN' },
        { workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE, traceId },
      );

      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
          entityRef: user.id,
          traceId,
          objectSnapshot: {
            userNo: user.userNo,
            email: user.email,
            roleCodes,
            changeReason: dto.changeReason || null,
            status: user.status,
          },
        },
        {
          reason: dto.changeReason || `Admin invite request for ${user.email}`,
          traceId,
        },
        actor,
      );
    } catch (error) {
      await this.usersDomainService.physicalDelete(user.id);
      throw error;
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_INVITE.INVITE_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          userEmail: user.email,
          roleCodes,
          approvalNo: approvalCase.approvalNo,
          changeReason: dto.changeReason || null,
        },
        requestId: `ADMIN_INVITE_REQUESTED_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      userId: user.id,
      userNo: user.userNo,
      email: user.email,
      status: 'PENDING_INVITE_APPROVAL',
      approvalNo: approvalCase.approvalNo,
      approvalStatus: approvalCase.status,
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeInviteDispatch(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.executeInviteCancellation(event);
    }
  }

  private async executeInviteDispatch(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    try {
      await this.usersDomainService.updateStatus(user.id, 'INVITE_SENT');

      const invitation = await this.adminInvitationsService.createInvitationForUser({
        userId: user.id,
        actor: {
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
        },
        auditContext: {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
        },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_LINK_DISPATCHED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            inviteExpiresAt: invitation.inviteExpiresAt,
          },
          requestId: `ADMIN_INVITE_DISPATCHED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      );

    } catch (error) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_LINK_DISPATCHED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          reason: error instanceof Error ? error.message : 'Failed to dispatch invite',
          metadata: { approvalId: event.approvalId },
          requestId: `ADMIN_INVITE_DISPATCH_FAILED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      );

      throw error;
    }
  }

  private async executeInviteCancellation(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    await this.usersDomainService.physicalDelete(user.id);

    await this.auditLogsService
      .recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_CANCELLED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            decision: event.decision,
            decisionReason: event.decisionReason,
          },
          requestId: `ADMIN_INVITE_CANCELLED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      )
      .catch(() => undefined);
  }

  async resendInvitation(userId: string, actor: ApprovalActorContext) {
    const user = await this.usersDomainService.findById(userId);
    if (!user) throw new InternalServerErrorException('User not found');

    return this.adminInvitationsService.resendInvitationForUser({
      userId: user.id,
      actor: {
        actorId: actor.userId,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
        actorNo: actor.userNo,
      },
      auditContext: {
        workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
      },
    });
  }
}
