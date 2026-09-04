import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { assertFeeLevelTransition, FeeLevelAction } from '../shared/fee-level-transitions.constant';

// 二级"已裁决"事件名由 approval-handler.base.ts 按 workflowType 推导：workflow.<kebab>.decided
const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-retire.decided';

/** "删" = 退役终态（spec §7）：CFO 提、运营批；最后一个 ACTIVE 默认档不可退。 */
@Injectable()
export class WithdrawalFeeLevelRetireWorkflowService {
  private readonly logger = new Logger(WithdrawalFeeLevelRetireWorkflowService.name);

  constructor(
    private readonly feeLevelService: WithdrawalFeeLevelService,
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

  async requestRetire(levelCode: string, reason: string, actor: ApprovalActorContext) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    assertFeeLevelTransition(level.status, FeeLevelAction.RETIRE);
    if (level.approvalCaseNo || level.pendingChangeRequest) {
      throw new ConflictException(`Level ${levelCode} already has a pending approval (${level.approvalCaseNo ?? level.pendingChangeRequest?.approvalCaseNo})`);
    }
    await this.feeLevelService.assertNotLastActiveDefault(level);

    // START：本次退役旅程的 correlationId，同一个值写进 ApprovalCase.traceId，下游经 ApprovalDecidedEvent.traceId INHERIT 读回
    const correlationId = randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_RETIRE,
        entityRef: levelCode,
        traceId: correlationId,
        objectSnapshot: { levelCode, name: level.name, isDefault: level.isDefault, assetId: level.assetId, reason },
      },
      { reason, traceId: correlationId },
      actor,
    );
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_FEE_LEVEL_RETIRE_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        beforeData: { status: level.status },
        metadata: { approvalNo: approvalCase.approvalNo },
        requestId: `WITHDRAWAL_FEE_LEVEL_RETIRE_REQUESTED_${levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { levelCode, approvalNo: approvalCase.approvalNo, status: 'PENDING_APPROVAL' };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (!event?.entityRef || !event?.approvalId) {
      this.logger.warn('Withdrawal fee level retire decided event missing entityRef/approvalId');
      return;
    }
    if (event.decision === 'APPROVED') await this.executeRetire(event);
    else await this.cancelRetire(event);
  }

  private async executeRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      await this.feeLevelService.retireLevel(levelCode);
      await this.auditLogsService.recordSystem({
        action: 'WITHDRAWAL_FEE_LEVEL_RETIRED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        approvalNo: event.approvalNo,
        fromStatus: 'ACTIVE',
        toStatus: 'RETIRED',
        metadata: { retiredByUserNo: event.decisionByUserNo },
        requestId: `WITHDRAWAL_FEE_LEVEL_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.log(`Withdrawal fee level ${levelCode} retired`);
    } catch (err: any) {
      // 双结局：失败不单独起名——同码 outcome=FAILED + reasonCode
      await this.auditLogsService.recordSystem({
        action: 'WITHDRAWAL_FEE_LEVEL_RETIRED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err?.message ?? 'retire execution failed',
        approvalNo: event.approvalNo,
        requestId: `WITHDRAWAL_FEE_LEVEL_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.error(`Failed to retire withdrawal fee level ${levelCode}: ${err?.message}`);
    }
  }

  private async cancelRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      await this.feeLevelService.clearApprovalCase(levelCode);
      await this.auditLogsService.recordSystem({
        action: 'WITHDRAWAL_FEE_LEVEL_RETIRE_CANCELLED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event.decisionReason || `Withdrawal fee level retire request ${String(event.decision).toLowerCase()}`,
        metadata: { decision: event.decision, approvalNo: event.approvalNo },
        requestId: `WITHDRAWAL_FEE_LEVEL_RETIRE_CANCELLED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(`Failed to cancel retire for ${levelCode}: ${err?.message}`);
    }
  }
}
