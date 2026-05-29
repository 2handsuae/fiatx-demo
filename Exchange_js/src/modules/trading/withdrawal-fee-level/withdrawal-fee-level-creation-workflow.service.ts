import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';

const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-creation.decided';

@Injectable()
export class WithdrawalFeeLevelCreationWorkflowService {
  private readonly logger = new Logger(WithdrawalFeeLevelCreationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiateCreate(
    dto: {
      levelCode: string;
      name: string;
      assetId: string;
      isDefault: boolean;
      tiersJson: string;
      reason: string;
    },
    actor: ApprovalActorContext,
  ) {
    const { levelCode, name, assetId, isDefault, tiersJson, reason } = dto;

    if (!reason?.trim()) {
      throw new BadRequestException('reason is required');
    }

    // INSERT with PENDING_APPROVAL (uniqueness + tiersJson validation in L1)
    const level = await this.feeLevelService.createLevel({
      levelCode,
      name,
      assetId,
      isDefault,
      tiersJson,
      createdByUserId: actor.userId,
    });

    // Create approval case
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
          entityRef: level.id,
          traceId,
          objectSnapshot: {
            levelId: level.id,
            levelCode,
            name,
            assetId,
            isDefault,
            tiersJson,
            reason,
          },
        },
        { reason, traceId },
        actor,
      );
    } catch (err) {
      // Rollback: delete the inserted row
      await this.feeLevelService.deleteById(level.id);
      throw err;
    }

    // Link approval case to level
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    // Audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CREATION.CREATION_REQUESTED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: level.id,
        entityNo: level.levelCode,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          levelCode,
          name,
          assetId,
          isDefault,
          reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED_${level.levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
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
      this.logger.warn('Withdrawal fee level creation decided event missing approvalId or entityRef');
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
      level = await this.prisma.withdrawalFeeLevel.findUnique({
        where: { id: levelId },
      });
      if (!level || level.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Level ${levelId} not found or not in PENDING_APPROVAL status`);
        return;
      }

      await this.feeLevelService.activateLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CREATION.CREATION_APPLIED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: level.id,
        entityNo: level.levelCode,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          levelCode: level.levelCode,
          name: level.name,
          assetId: level.assetId,
          isDefault: level.isDefault,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} activated`);
    } catch (err: any) {
      this.logger.error(`Failed to activate level ${levelId}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CREATION.CREATION_APPLY_FAILED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: levelId,
        entityNo: level?.levelCode,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        requestId: `WITHDRAWAL_FEE_LEVEL_CREATION_APPLY_FAILED_${levelId}`,
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
      const level = await this.prisma.withdrawalFeeLevel.findUnique({
        where: { id: levelId },
      });
      if (!level) {
        this.logger.warn(`Level ${levelId} not found for cancellation`);
        return;
      }

      await this.feeLevelService.deleteRejectedLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CREATION.CREATION_CANCELLED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: level.id,
        entityNo: level.levelCode,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: { decision },
        requestId: `WITHDRAWAL_FEE_LEVEL_CREATION_CANCELLED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel level creation ${levelId}: ${err.message}`);
    }
  }
}
