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
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
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
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
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

    // START：本次策略变更旅程的 correlationId。ApprovalPolicyChangeRequest 表没有
    // traceId/correlationId 列，同一个值同事务写进 ApprovalCase.traceId（经
    // createAndSubmit 的 traceId 入参）承载，供下游 executePolicyChange 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();
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
        entityRef: request.requestNo,
        traceId: correlationId,
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
      { reason: changeReason, traceId: correlationId },
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

    // 10. Audit: APPROVAL_POLICY_CHANGE_REQUESTED（不复用 APPROVAL_SUBMITTED——发起变更的
    // PRIMARY 是审批策略，提交审批的 PRIMARY 是审批单，拆条判据乙"PRIMARY 不同必须拆"）
    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_POLICY_CHANGE_REQUESTED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_POLICY,
        primarySubjectNo: requestNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: changeReason,
        // beforeData/afterData 只存变更项——steps 本身就是"变更项"整体（proposedSteps 与
        // currentPolicy.steps 不同才会走到这里，见上面第 5 步 No-change guard），checkerRoles
        // 是从 steps 派生出的同一份信息，不重复存。
        beforeData: { steps: currentPolicy.steps },
        afterData: { steps: proposedSteps },
        metadata: {
          targetActionType,
          currentCheckerRoles: currentPolicy.checkerRoles,
          proposedCheckerRoles,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
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
    // entityRef 现在存 requestNo（铁律⑥），按号回查。
    const request = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { requestNo: event.entityRef },
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
          action: 'APPROVAL_POLICY_CHANGE_APPLIED',
          actionDomain: 'CONFIG',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.APPROVAL_POLICY,
          primarySubjectNo: request.requestNo,
          // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 requestChange 铸造的
          // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
          correlationId: event.traceId,
          // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
          causationId: event.approvalId,
          outcome: AuditOutcome.SUCCESS,
          beforeData: { steps: request.currentStepsConfig ? JSON.parse(request.currentStepsConfig) : null },
          afterData: { steps: proposedSteps },
          // policyVersion 占位固定 1，同 approvals.service.ts recordSubmitted() 的已知限制
          // （ApprovalActionPolicy 单行 upsert 覆盖、无 version 列）——不是这里现造的新债，
          // 见该处大段注释与 BACKLOG「技术债 — V1 审计底座」。
          policyVersion: 1,
          approvalNo: event.approvalNo,
          metadata: {
            targetActionType: request.targetActionType,
            appliedCheckerRoles: deriveCheckerRoles(proposedSteps),
          },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: event.decisionByUserNo || 'UNKNOWN',
          actorDisplayName: event.decisionByUserNo || 'UNKNOWN',
          actorRolesAtTime: [event.decisionByRole || 'SYSTEM'],
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

      // 退役码 MODIFICATION_APPLY_FAILED 收编进来——同一动作码 APPROVAL_POLICY_CHANGE_APPLIED，
      // 靠 outcome=FAILED 区分，不另起一个 _FAILED 后缀码（词表未给这一步单独开码）。
      await this.auditLogsService.recordByActor(
        {
          action: 'APPROVAL_POLICY_CHANGE_APPLIED',
          actionDomain: 'CONFIG',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.APPROVAL_POLICY,
          primarySubjectNo: request.requestNo,
          correlationId: event.traceId,
          causationId: event.approvalId,
          outcome: AuditOutcome.FAILED,
          reason: failureReason,
          beforeData: { steps: request.currentStepsConfig ? JSON.parse(request.currentStepsConfig) : null },
          afterData: { steps: proposedSteps },
          policyVersion: 1,
          approvalNo: event.approvalNo,
          metadata: {
            targetActionType: request.targetActionType,
          },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: event.decisionByUserNo || 'SYSTEM',
          actorDisplayName: event.decisionByUserNo || 'SYSTEM',
          actorRolesAtTime: [event.decisionByRole || 'SYSTEM'],
        },
      );

    }
  }

  // ─── Terminate Request (on DECLINED / CANCELLED / EXPIRED) ──

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    // entityRef 现在存 requestNo（铁律⑥），按号回查。
    const request = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { requestNo: event.entityRef },
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
