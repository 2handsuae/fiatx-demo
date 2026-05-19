import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
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
import { CreateRoleChangeRequestDto, RoleChangeRequestQueryDto } from './dto/create-role-change-request.dto';

const SECONDARY_EVENT = 'workflow.admin-role-binding-change.decided';

@Injectable()
export class AdminRoleBindingChangeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly approvalsService: ApprovalsService,
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

  async createRoleChangeRequest(
    dto: CreateRoleChangeRequestDto,
    actor: ApprovalActorContext,
  ) {
    if (dto.targetUserId === actor.userId) {
      throw new BadRequestException('Cannot change your own role bindings');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.targetUserId, deletedAt: null },
      select: { id: true, userNo: true, email: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const currentRoleCodes = await this.accessControlService.getUserRoleCodes(
      dto.targetUserId,
    );

    this.accessControlService.validateHardMutex(dto.roleCodes);

    const traceId = dto.traceId || randomUUID();
    const requestNo = generateReferenceNo('RCR-');

    const request = await (this.prisma as any).adminRoleChangeRequest.create({
      data: {
        requestNo,
        targetUserId: dto.targetUserId,
        currentRoleCodes: JSON.stringify(currentRoleCodes),
        proposedRoleCodes: JSON.stringify(dto.roleCodes),
        changeReason: dto.changeReason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
        entityRef: request.id,
        traceId,
        objectSnapshot: {
          requestNo: request.requestNo,
          targetUserId: request.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          currentRoleCodes: JSON.parse(request.currentRoleCodes),
          proposedRoleCodes: JSON.parse(request.proposedRoleCodes),
          changeReason: request.changeReason,
          status: request.status,
          createdAt: request.createdAt,
        },
      },
      { reason: dto.changeReason, traceId },
      actor,
    );

    const updated = await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_ROLE_BINDING_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetUserId: targetUser.id,
          targetUserNo: targetUser.userNo,
          currentRoleCodes,
          proposedRoleCodes: dto.roleCodes,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_ROLE_BINDING_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return updated;
  }

  async findRoleChangeRequests(query: RoleChangeRequestQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: any = { deletedAt: null };
    if (query.targetUserId) where.targetUserId = query.targetUserId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).adminRoleChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { targetUser: { select: { id: true, userNo: true, email: true } } },
      }),
      (this.prisma as any).adminRoleChangeRequest.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findRoleChangeRequest(id: string) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id, deletedAt: null },
      include: { targetUser: { select: { id: true, userNo: true, email: true } } },
    });
    if (!request) {
      throw new NotFoundException('Role change request not found');
    }
    return request;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeRoleChange(event);
      case 'DECLINED':
        return this.executeTermination(event, 'REJECTED');
      case 'CANCELLED':
        return this.executeTermination(event, 'CANCELLED');
      case 'EXPIRED':
        return this.executeTermination(event, 'EXPIRED');
    }
  }

  private async executeRoleChange(event: ApprovalDecidedEvent) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    const targetUser = await this.prisma.user.findFirst({
      where: { id: request.targetUserId, deletedAt: null },
      select: { id: true, userNo: true },
    });
    if (!targetUser) return;

    const proposedRoleCodes: string[] = JSON.parse(request.proposedRoleCodes);
    const systemActor = {
      actorId: event.decisionByUserId || 'SYSTEM',
      actorNo: event.decisionByUserNo || undefined,
      actorRole: event.decisionByRole || 'SYSTEM',
    };

    try {
      await this.accessControlService.replaceUserRoles(
        request.targetUserId,
        proposedRoleCodes,
        systemActor,
        {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
        },
      );

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_ROLE_BINDING_CHANGE.CHANGE_APPLIED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            targetUserId: targetUser.id,
            targetUserNo: targetUser.userNo,
            appliedRoleCodes: proposedRoleCodes,
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
          },
          requestId: `ADMIN_ROLE_BINDING_CHANGE_APPLIED_${request.requestNo}`,
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
      const failureReason =
        error instanceof Error ? error.message : 'Unknown execution error';

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', failureReason },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_ROLE_BINDING_CHANGE.CHANGE_APPLY_FAILED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          reason: failureReason,
          metadata: {
            targetUserId: request.targetUserId,
            failureReason,
          },
          requestId: `ADMIN_ROLE_BINDING_CHANGE_APPLY_FAILED_${request.requestNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      );

    }
  }

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: { status },
    });
  }
}
