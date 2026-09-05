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
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';

const SECONDARY_EVENT = 'workflow.swap-fee-level-change.decided';

@Injectable()
export class SwapFeeLevelChangeWorkflowService {
  private readonly logger = new Logger(SwapFeeLevelChangeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: SwapFeeLevelService,
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
    if (level.approvalCaseNo) {
      throw new ConflictException(`Level ${levelCode} has a pending approval (${level.approvalCaseNo})`);
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

    // 4. Create approval case (entityRef = request.requestNo，铁律⑥ 对外用业务键)
    // START：本次变更旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeChange/cancelChange 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE,
          entityRef: request.requestNo,
          traceId: correlationId,
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
          traceId: correlationId,
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
        action: 'SWAP_FEE_LEVEL_CHANGE_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: level.levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: changeReason.trim(),
        beforeData: { tiersJson: level.tiersJson },
        afterData: { tiersJson: proposedTiersJson },
        metadata: {
          levelId: level.id,
          levelCode: level.levelCode,
          approvalNo: approvalCase.approvalNo,
        },
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: level.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `SWAP_FEE_LEVEL_CHANGE_REQUESTED_${requestNo}`,
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
      this.logger.warn('Swap fee level change decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeChange(approvalId, entityRef, event);
    } else {
      await this.cancelChange(approvalId, entityRef, decision, event);
    }
  }

  private async executeChange(approvalId: string, requestNo: string, event: any) {
    let request: Awaited<ReturnType<typeof this.prisma.swapFeeLevelChangeRequest.findUnique>> | null = null;
    try {
      // 1. Load request, verify PENDING_APPROVAL
      request = await this.prisma.swapFeeLevelChangeRequest.findUnique({
        where: { requestNo },
      });
      if (!request || request.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Change request ${requestNo} not found or not PENDING_APPROVAL`);
        return;
      }

      // 2. Apply change via L1 (hash conflict check runs inside transaction)
      try {
        await this.feeLevelService.executeChange(request.requestNo);
      } catch (err) {
        if (err instanceof ConflictException || err instanceof NotFoundException) {
          const reason = err.message;
          await this.auditLogsService.recordSystem({
            action: 'SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED',
            actionDomain: 'CONFIG',
            primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
            primarySubjectNo: request.levelCode,
            correlationId: event?.traceId,
            causationId: approvalId,
            outcome: AuditOutcome.FAILED,
            reasonCode: 'CONFLICT',
            reason,
            metadata: { levelId: request.levelId, levelCode: request.levelCode },
            subjects: [
              { subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
              { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
            ],
            requestId: `SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED_${request.requestNo}`,
            sourcePlatform: 'SYSTEM',
          });
          this.logger.warn(`Change request ${request.requestNo} failed: ${reason}`);
          return;
        }
        throw err;
      }

      // 5. Audit CHANGE_APPLIED
      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CHANGE_APPLIED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: request.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        beforeData: { tiersJson: request.currentTiersJson },
        afterData: { tiersJson: request.proposedTiersJson },
        approvalNo: event?.approvalNo,
        metadata: { levelId: request.levelId, levelCode: request.levelCode },
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `SWAP_FEE_LEVEL_CHANGE_APPLIED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} executed: ${request.levelCode} tiers updated`);
    } catch (err: any) {
      this.logger.error(`Failed to execute change request ${requestNo}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: request?.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err.message,
        subjects: [
          ...(request?.levelCode ? [{ subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY }] : []),
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED_${requestNo}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async cancelChange(
    approvalId: string,
    requestNo: string,
    decision: string,
    event: any,
  ) {
    try {
      const request = await this.prisma.swapFeeLevelChangeRequest.findUnique({
        where: { requestNo },
      });
      if (!request) {
        this.logger.warn(`Change request ${requestNo} not found for cancellation`);
        return;
      }

      // Update request status
      if (decision === 'DECLINED') {
        await this.feeLevelService.rejectChangeRequest(request.requestNo);
      } else if (decision === 'EXPIRED') {
        await this.feeLevelService.expireChangeRequest(request.requestNo);
      } else {
        await this.feeLevelService.cancelChangeRequest(request.requestNo);
      }

      // Audit
      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_CHANGE_CANCELLED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: request.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event?.decisionReason || `Swap fee level change request ${String(decision).toLowerCase()}`,
        metadata: {
          decision,
          levelId: request.levelId,
          levelCode: request.levelCode,
          approvalNo: event?.approvalNo,
        },
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `SWAP_FEE_LEVEL_CHANGE_CANCELLED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} cancelled (${decision})`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel change request ${requestNo}: ${err.message}`);
    }
  }
}
