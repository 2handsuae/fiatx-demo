// src/modules/withdraw-sumsub/withdraw-sla.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawTransactionAction } from '../trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';

/**
 * onHold(COMPLIANCE_PENDING)/ACTION_PENDING SLA breach timer — mirror of
 * DepositSlaService (Task 5). Scans for withdrawals whose slaDeadline (set by
 * WithdrawWorkflowService.applyKytOnHold / applyKytAwaitUser) has passed and
 * routes them to MANUAL_CHECKING, marking slaBreached=true so the scan doesn't
 * re-process them.
 */
@Injectable()
export class WithdrawSlaService {
  private readonly logger = new Logger(WithdrawSlaService.name);

  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.checkSlaBreaches();
  }

  // Core scan logic, kept separate from the @Cron wrapper so it's directly
  // callable in tests without waiting on a real clock.
  async checkSlaBreaches(): Promise<void> {
    const now = new Date();
    const candidates = await this.withdrawService.findSlaBreachCandidates(now);

    for (const withdraw of candidates) {
      await this.breach(withdraw);
    }
  }

  private async breach(withdraw: any): Promise<void> {
    const oldStatus = withdraw.status;

    await this.withdrawService.updateStatus(
      withdraw.id,
      {
        action: WithdrawTransactionAction.SLA_BREACH,
        reason: 'SLA breached: no compliance action before deadline',
      },
      {
        source: 'SYSTEM',
        actorType: 'SYSTEM',
        actorId: 'SLA_TIMER',
        sourcePlatform: 'SYSTEM',
        extraData: { slaBreached: true },
      },
    );

    this.logger.warn(
      `Withdrawal ${withdraw.id} SLA breached (was ${oldStatus}, deadline ${withdraw.slaDeadline?.toISOString?.() ?? withdraw.slaDeadline}) → MANUAL_CHECKING`,
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SLA_BREACHED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: withdraw.id,
      entityNo: withdraw.withdrawNo,
      entityOwnerType: withdraw.ownerType,
      entityOwnerId: withdraw.ownerId,
      traceId: withdraw.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `SLA breached: withdrawal was ${oldStatus} past its slaDeadline, routed to manual review`,
      metadata: { fromStatus: oldStatus, slaDeadline: withdraw.slaDeadline },
      sourcePlatform: 'SYSTEM',
    });
  }
}
