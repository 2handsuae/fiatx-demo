// src/modules/deposit-sumsub/deposit-sla.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { DepositTransactionAction } from '../trading/deposit-transactions/dto/deposit-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../audit-logging/constants/audit-actions.constant';

/**
 * onHold(COMPLIANCE_PENDING)/ACTION_PENDING SLA breach timer (Task 10). Scans
 * for deposits whose slaDeadline (set by DepositWorkflowService.applyKytOnHold
 * / applyKytAwaitUser) has passed and routes them to MANUAL_CHECKING, marking
 * slaBreached=true so the scan doesn't re-process them.
 */
@Injectable()
export class DepositSlaService {
  private readonly logger = new Logger(DepositSlaService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
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
    const candidates = await this.depositService.findSlaBreachCandidates(now);

    for (const deposit of candidates) {
      await this.breach(deposit);
    }
  }

  private async breach(deposit: any): Promise<void> {
    const oldStatus = deposit.status;

    const updated = await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.SLA_BREACH,
        reason: 'SLA breached: no compliance action before deadline',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'SLA_TIMER' },
        sourcePlatform: 'SYSTEM',
        extraData: { slaBreached: true },
      },
    );

    this.logger.warn(
      `Deposit ${deposit.id} SLA breached (was ${oldStatus}, deadline ${deposit.slaDeadline?.toISOString?.() ?? deposit.slaDeadline}) → MANUAL_CHECKING`,
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SLA_BREACHED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: `SLA breached: deposit was ${oldStatus} past its slaDeadline, routed to manual review`,
      metadata: { fromStatus: oldStatus, slaDeadline: deposit.slaDeadline },
      sourcePlatform: 'SYSTEM',
    });
  }
}
