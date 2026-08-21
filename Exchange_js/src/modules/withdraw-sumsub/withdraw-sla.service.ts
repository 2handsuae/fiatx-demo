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
 * COMPLIANCE_PENDING/ACTION_PENDING SLA breach timer — mirror of
 * DepositSlaService (Task 5). Scans for withdrawals whose slaDeadline has
 * passed and routes them to MANUAL_CHECKING, marking slaBreached=true so the
 * scan doesn't re-process them.
 *
 * ⚠️ 2026-08-21：deadline 按「状态」计时——进入 COMPLIANCE_PENDING /
 * ACTION_PENDING 时由 WithdrawTransactionsService.resolveSlaFields 统一设
 * （在 updateStatus 等状态机收口处），**不再**由 WithdrawWorkflowService
 * .applyKytOnHold 之类的 webhook 回调设（该方法已明确不碰 slaDeadline，
 * 理由见其 JSDoc）。此前挂在 onHold 回调上时，只有收到过 onHold 的单会
 * 计时；现在这个扫描器对所有进入 COMPLIANCE_PENDING / ACTION_PENDING 的
 * 单都生效。不要把 SLA 逻辑再绑回任何 webhook 上。
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
