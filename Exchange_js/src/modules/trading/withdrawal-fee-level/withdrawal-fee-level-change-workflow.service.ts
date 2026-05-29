import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-change.decided';

@Injectable()
export class WithdrawalFeeLevelChangeWorkflowService {
  private readonly logger = new Logger(WithdrawalFeeLevelChangeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
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

  async requestChange(
    levelCode: string,
    proposedTiersJson: string,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    // 1. Find level, verify it exists and is ACTIVE
    const level = await this.feeLevelService.findByLevelCode(levelCode);

    if (level.status !== 'ACTIVE') {
      throw new ConflictException(
        `Level ${levelCode} is not ACTIVE (current status: ${level.status}). Cannot submit a change request.`,
      );
    }

    // 2. Validate input
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required');
    }

    // 3. Create change request via L1 (validates tiersJson, checks pending duplicates)
    const request = await this.feeLevelService.createChangeRequest({
      levelId: level.id,
      levelCode: level.levelCode,
      proposedTiersJson,
      changeReason: changeReason.trim(),
      requestedByUserId: actor.userId,
    });
    const requestNo = request.requestNo;

    // 4. Create approval case (entityRef = request.id)
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
          entityRef: request.id,
          traceId,
          objectSnapshot: {
            requestId: request.id,
            requestNo,
            levelId: level.id,
            levelCode: level.levelCode,
            currentTiersJson: level.tiersJson,
            proposedTiersJson,
            changeReason: changeReason.trim(),
          },
        },
        {
          reason: changeReason.trim(),
          traceId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: cancel the request row
      await this.feeLevelService.cancelChangeRequest(request.requestNo);
      throw err;
    }

    // 5. Link approval case to request
    await this.feeLevelService.linkApprovalCaseToRequest(request.requestNo, approvalCase.id, approvalCase.approvalNo);

    // 6. Audit CHANGE_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          levelId: level.id,
          levelCode: level.levelCode,
          currentTiersJson: level.tiersJson,
          proposedTiersJson,
          changeReason: changeReason.trim(),
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      requestNo,
      levelCode: level.levelCode,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: any) {
    const decision = event?.decision;
    const approvalId = event?.approvalId;
    const entityRef = event?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Withdrawal fee level change decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeChange(approvalId, entityRef, event);
    } else {
      await this.cancelChange(approvalId, entityRef, decision, event);
    }
  }

  private async executeChange(approvalId: string, requestId: string, event: any) {
    let request: Awaited<ReturnType<typeof this.prisma.withdrawalFeeLevelChangeRequest.findUnique>> | null = null;
    try {
      // 1. Load request, verify PENDING_APPROVAL
      request = await this.prisma.withdrawalFeeLevelChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request || request.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Change request ${requestId} not found or not PENDING_APPROVAL`);
        return;
      }

      // 2. Apply change via L1 (hash conflict check runs inside transaction)
      try {
        await this.feeLevelService.executeChange(request.requestNo);
      } catch (err) {
        if (err instanceof ConflictException || err instanceof NotFoundException) {
          const reason = err.message;
          await this.feeLevelService.markRequestExecutionFailed(request.requestNo, reason);
          await this.auditLogsService.recordSystem({
            action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.CHANGE_APPLY_FAILED,
            entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
            entityId: request.id,
            entityNo: request.requestNo,
            workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
            traceId: event?.traceId,
            result: AuditResult.FAILED,
            reason,
            metadata: { levelId: request.levelId, levelCode: request.levelCode },
            requestId: `WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED_${request.requestNo}`,
            sourcePlatform: 'SYSTEM',
          });
          this.logger.warn(`Change request ${request.requestNo} failed: ${reason}`);
          return;
        }
        throw err;
      }

      // 5. Audit CHANGE_APPLIED
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.CHANGE_APPLIED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          levelId: request.levelId,
          levelCode: request.levelCode,
          currentTiersJson: request.currentTiersJson,
          proposedTiersJson: request.proposedTiersJson,
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_CHANGE_APPLIED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} executed: ${request.levelCode} tiers updated`);
    } catch (err: any) {
      this.logger.error(`Failed to execute change request ${requestId}: ${err.message}`);

      // Try to mark as failed
      if (request) {
        try {
          await this.feeLevelService.markRequestExecutionFailed(request.requestNo, err.message);
        } catch { /* ignore */ }
      }

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.CHANGE_APPLY_FAILED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: requestId,
        entityNo: request?.requestNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        reason: err.message,
        metadata: { approvalId },
        requestId: `WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED_${requestId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async cancelChange(
    approvalId: string,
    requestId: string,
    decision: string,
    event: any,
  ) {
    try {
      const request = await this.prisma.withdrawalFeeLevelChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) {
        this.logger.warn(`Change request ${requestId} not found for cancellation`);
        return;
      }

      // Update request status
      if (decision === 'REJECTED') {
        await this.feeLevelService.rejectChangeRequest(request.requestNo);
      } else {
        await this.feeLevelService.cancelChangeRequest(request.requestNo);
      }

      // Audit
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.CHANGE_CANCELLED,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          decision,
          levelId: request.levelId,
          levelCode: request.levelCode,
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_CHANGE_CANCELLED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} cancelled (${decision})`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel change request ${requestId}: ${err.message}`);
    }
  }
}
