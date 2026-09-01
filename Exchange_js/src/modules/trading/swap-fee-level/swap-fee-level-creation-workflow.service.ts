import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';

const SECONDARY_EVENT = 'workflow.swap-fee-level-creation.decided';

@Injectable()
export class SwapFeeLevelCreationWorkflowService {
  private readonly logger = new Logger(SwapFeeLevelCreationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiateCreate(
    dto: {
      levelCode: string;
      name: string;
      fromAssetId: string;
      toAssetId: string;
      isDefault: boolean;
      tiersJson: string;
      reason: string;
      requiredTags?: string[];
      validFrom?: string;
      validTo?: string;
    },
    actor: ApprovalActorContext,
  ) {
    const { levelCode, name, fromAssetId, toAssetId, isDefault, tiersJson, reason, requiredTags, validFrom, validTo } = dto;

    if (!reason?.trim()) {
      throw new BadRequestException('reason is required');
    }

    // INSERT with PENDING_APPROVAL (uniqueness + tiersJson validation in L1)
    const level = await this.feeLevelService.createLevel({
      levelCode,
      name,
      fromAssetId,
      toAssetId,
      isDefault,
      tiersJson,
      createdByUserId: actor.userId,
      requiredTags,
      validFrom,
      validTo,
    });

    // Create approval case
    // START：本次创建旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeActivation/executeCancellation
    // 经 ApprovalDecidedEvent.traceId INHERIT 读回——与角色定义创建工作流同款模式。
    const correlationId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION,
          entityRef: level.id,
          traceId: correlationId,
          objectSnapshot: {
            levelId: level.id,
            levelCode,
            name,
            fromAssetId,
            toAssetId,
            isDefault,
            tiersJson,
            reason,
            requiredTags: requiredTags ?? [],
            validFrom: validFrom ?? null,
            validTo: validTo ?? null,
          },
        },
        { reason, traceId: correlationId },
        actor,
      );
    } catch (err) {
      // Rollback: delete the inserted row
      await this.feeLevelService.deleteById(level.id);
      throw err;
    }

    // Link approval case to level
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    // afterData：CREATE 没有「前」态，只存提案身份本身——不存 status/id/createdAt 等机械字段。
    const afterData = {
      levelCode,
      name,
      fromAssetId,
      toAssetId,
      isDefault,
      tiersJson,
      requiredTags: requiredTags ?? [],
      validFrom: validFrom ?? null,
      validTo: validTo ?? null,
    };

    // Audit
    await this.auditLogsService.recordByActor(
      {
        action: 'SWAP_FEE_LEVEL_CREATION_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: level.levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        afterData,
        metadata: {
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `SWAP_FEE_LEVEL_CREATION_REQUESTED_${level.levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.userNo || 'UNKNOWN',
        actorDisplayName: actor.userNo || 'UNKNOWN',
        actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
      },
    );

    return {
      levelCode: level.levelCode,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Swap fee level creation decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  private async executeActivation(approvalId: string, levelId: string, event: any) {
    let level: any;
    try {
      level = await this.prisma.swapFeeLevel.findUnique({
        where: { id: levelId },
      });
      if (!level || level.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Level ${levelId} not found or not in PENDING_APPROVAL status`);
        return;
      }

      await this.feeLevelService.activateLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CREATION_APPLIED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: level.levelCode,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateCreate 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event?.traceId,
        // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        afterData: {
          levelCode: level.levelCode,
          name: level.name,
          fromAssetId: level.fromAssetId,
          toAssetId: level.toAssetId,
          isDefault: level.isDefault,
          tiersJson: level.tiersJson,
        },
        approvalNo: event?.approvalNo,
        requestId: `SWAP_FEE_LEVEL_CREATION_APPLIED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} activated`);
    } catch (err: any) {
      this.logger.error(`Failed to activate level ${levelId}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CREATION_APPLY_FAILED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: level?.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err.message,
        requestId: `SWAP_FEE_LEVEL_CREATION_APPLY_FAILED_${levelId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(
    approvalId: string,
    levelId: string,
    decision: string,
    event: any,
  ) {
    try {
      const level = await this.prisma.swapFeeLevel.findUnique({
        where: { id: levelId },
      });
      if (!level) {
        this.logger.warn(`Level ${levelId} not found for cancellation`);
        return;
      }

      await this.feeLevelService.deleteRejectedLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CREATION_CANCELLED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: level.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event?.decisionReason || `Swap fee level creation request ${String(decision).toLowerCase()}`,
        metadata: { decision },
        requestId: `SWAP_FEE_LEVEL_CREATION_CANCELLED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel level creation ${levelId}: ${err.message}`);
    }
  }
}
