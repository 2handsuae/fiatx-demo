import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalPolicyService } from './approval-policy.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalDecidedEvent } from './approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  V1_APPROVAL_ACTION_TYPES,
  PolicyStepConfig,
  deriveCheckerRoles,
  parseAndValidateStepsConfig,
  checkerRolesToSteps,
} from './constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const SECONDARY_EVENT = 'workflow.approval-policy.decided';

@Injectable()
export class ApprovalPolicyChangeWorkflowService {
  private readonly logger = new Logger(ApprovalPolicyChangeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly policyService: ApprovalPolicyService,
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

  // ─── Create Change Request ────────────────────────

  async requestChange(
    targetActionType: string,
    proposedSteps: PolicyStepConfig[],
    changeReason: string,
    actor: ApprovalActorContext,
  ): Promise<{ id: string; requestNo: string; approvalNo: string; approvalCaseId: string; status: string }> {
    // 1. Validate targetActionType in V1 whitelist
    if (!V1_APPROVAL_ACTION_TYPES.includes(targetActionType)) {
      throw new BadRequestException({
        code: 'INVALID_ACTION_TYPE',
        message: `Action type '${targetActionType}' is not a valid V1 approval type`,
      });
    }

    // 2. Self-protection
    if (targetActionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }

    // 3. Validate proposedSteps structure
    if (!proposedSteps || proposedSteps.length === 0) {
      throw new BadRequestException('proposedSteps must not be empty');
    }
    parseAndValidateStepsConfig(JSON.stringify(proposedSteps));

    // 4. Snapshot current policy
    const currentPolicy = await this.policyService.getPolicy(targetActionType);

    // 5. No-change guard (structural comparison with role normalization)
    const normalize = (steps: PolicyStepConfig[]) =>
      JSON.stringify(steps.map((s) => ({ ...s, roles: [...s.roles].sort() })));
    if (normalize(currentPolicy.steps) === normalize(proposedSteps)) {
      throw new ConflictException({
        code: 'NO_CHANGE',
        message: 'Proposed step configuration is identical to current configuration',
      });
    }

    // 6. Concurrent request guard
    const pendingExists = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { targetActionType, status: 'PENDING_APPROVAL', deletedAt: null },
    });
    if (pendingExists) {
      throw new ConflictException({
        code: 'PENDING_REQUEST_EXISTS',
        message: `A pending change request already exists for ${targetActionType} (${pendingExists.requestNo})`,
      });
    }

    const traceId = randomUUID();
    const requestNo = generateReferenceNo('APC');

    // 7. Create request (both JSON and CSV fields)
    const proposedCheckerRoles = deriveCheckerRoles(proposedSteps);
    const request = await this.prisma.approvalPolicyChangeRequest.create({
      data: {
        requestNo,
        targetActionType,
        currentCheckerRoles: currentPolicy.checkerRoles.join(','),
        proposedCheckerRoles: proposedCheckerRoles.join(','),
        currentStepsConfig: JSON.stringify(currentPolicy.steps),
        proposedStepsConfig: JSON.stringify(proposedSteps),
        changeReason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    // 8. Create and submit approval case
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
        entityRef: request.id,
        traceId,
        objectSnapshot: {
          requestNo: request.requestNo,
          targetActionType: request.targetActionType,
          currentCheckerRoles: request.currentCheckerRoles,
          proposedCheckerRoles: request.proposedCheckerRoles,
          currentStepsConfig: request.currentStepsConfig ? JSON.parse(request.currentStepsConfig) : null,
          proposedStepsConfig: request.proposedStepsConfig ? JSON.parse(request.proposedStepsConfig) : null,
          changeReason: request.changeReason,
          status: request.status,
          createdAt: request.createdAt,
        },
      },
      { reason: changeReason, traceId },
      actor,
    );

    // 9. Link approval case to request
    await this.prisma.approvalPolicyChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    // 10. Audit: MODIFICATION_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_REQUESTED,
        entityType: AuditEntityTypes.APPROVAL_POLICY,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetActionType,
          currentStepsConfig: currentPolicy.steps,
          proposedStepsConfig: proposedSteps,
          currentCheckerRoles: currentPolicy.checkerRoles,
          proposedCheckerRoles,
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `APPROVAL_POLICY_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      id: request.id,
      requestNo,
      approvalNo: approvalCase.approvalNo,
      approvalCaseId: approvalCase.id,
      status: 'PENDING_APPROVAL',
    };
  }

  // ─── Handle Approval Decision ─────────────────────

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent): Promise<void> {
    switch (event.decision) {
      case 'APPROVED':
        return this.executePolicyChange(event);
      case 'DECLINED':
        return this.executeTermination(event, 'REJECTED');
      case 'CANCELLED':
        return this.executeTermination(event, 'CANCELLED');
      case 'EXPIRED':
        return this.executeTermination(event, 'EXPIRED');
    }
  }

  // ─── Execute Policy Change (on APPROVED) ──────────

  private async executePolicyChange(event: ApprovalDecidedEvent): Promise<void> {
    const request = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    // Parse proposed steps — fallback to flat CSV for old records
    let proposedSteps: PolicyStepConfig[];
    if (request.proposedStepsConfig) {
      proposedSteps = parseAndValidateStepsConfig(request.proposedStepsConfig);
    } else {
      proposedSteps = checkerRolesToSteps(
        request.proposedCheckerRoles.split(',').filter(Boolean),
      );
    }

    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.policyService.upsertStepsConfig(
          request.targetActionType,
          proposedSteps,
          tx,
        );
        await tx.approvalPolicyChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', executedAt: new Date() },
        });
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLIED,
          entityType: AuditEntityTypes.APPROVAL_POLICY,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            targetActionType: request.targetActionType,
            appliedStepsConfig: proposedSteps,
            appliedCheckerRoles: deriveCheckerRoles(proposedSteps),
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
          },
          requestId: `APPROVAL_POLICY_MODIFICATION_APPLIED_${request.requestNo}`,
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

      this.logger.error(`Policy change execution failed: ${failureReason}`, (error as any)?.stack);

      await this.prisma.approvalPolicyChangeRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', failureReason },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLY_FAILED,
          entityType: AuditEntityTypes.APPROVAL_POLICY,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          reason: failureReason,
          metadata: {
            targetActionType: request.targetActionType,
            failureReason,
          },
          requestId: `APPROVAL_POLICY_MODIFICATION_APPLY_FAILED_${request.requestNo}`,
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

  // ─── Terminate Request (on DECLINED / CANCELLED / EXPIRED) ──

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    const request = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    await this.prisma.approvalPolicyChangeRequest.update({
      where: { id: request.id },
      data: { status },
    });
  }

  // ─── Read Operations ──────────────────────────────

  async listChangeRequests(query: {
    skip?: number;
    take?: number;
    status?: string;
  }): Promise<{ items: any[]; total: number }> {
    const where: any = { deletedAt: null };
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.approvalPolicyChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip || 0,
        take: query.take || 20,
      }),
      this.prisma.approvalPolicyChangeRequest.count({ where }),
    ]);

    return { items, total };
  }

  async getChangeRequestById(id: string): Promise<any> {
    return this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { id, deletedAt: null },
    });
  }
}
