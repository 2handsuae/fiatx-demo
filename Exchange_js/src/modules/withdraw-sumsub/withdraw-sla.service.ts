// src/modules/withdraw-sumsub/withdraw-sla.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  WithdrawTransactionsService,
  WITHDRAW_SLA_SOFT_STATUSES,
} from '../trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawTransactionAction } from '../trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';

/**
 * SLA 破线扫描 —— DepositSlaService 的镜像实现（2026-08-21 扩容至硬/软两
 * 类）。扫描 findSlaBreachCandidates 返回的四个状态，按状态分流：
 *   硬 SLA（COMPLIANCE_PENDING / ACTION_PENDING，等外部）→ 推 MANUAL_CHECKING
 *   软 SLA（MANUAL_CHECKING / PENDING_APPROVAL，等自己人）→ 只置 slaBreached，状态不动
 *
 * ⚠️ deadline 按「状态」计时——进入状态时由
 * WithdrawTransactionsService.resolveSlaFields 统一设（在 updateStatus 等
 * 状态机收口处），**不再**由 WithdrawWorkflowService.applyKytOnHold 之类的
 * webhook 回调设（该方法已明确不碰 slaDeadline，理由见其 JSDoc）。不要把
 * SLA 逻辑再绑回任何 webhook 上。
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

  private async breach(w: any): Promise<void> {
    const oldStatus = w.status;

    if (WITHDRAW_SLA_SOFT_STATUSES.has(oldStatus)) {
      await this.softBreach(w);
      return;
    }
    await this.hardBreach(w);
  }

  /**
   * 软 SLA：等自己人（合规官 / 审批人）超时。只置标记 + 写审计，**状态一步不动**。
   */
  private async softBreach(w: any): Promise<void> {
    await this.withdrawService.markSlaBreached(w.id);
    this.logger.warn(
      `Withdrawal ${w.withdrawNo} soft SLA breached in ${w.status} (deadline ${w.slaDeadline?.toISOString?.() ?? w.slaDeadline}) — flagged only, status unchanged`,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SLA_BREACHED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Soft SLA breached in ${w.status} — internal handling overdue, order status intentionally unchanged`,
      metadata: { slaType: 'SOFT', status: w.status, slaDeadline: w.slaDeadline, waitingOn: 'INTERNAL' },
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 硬 SLA：等外部（客户交材料 / Sumsub 回裁决）超时。我方有权处置 → 推状态。
   */
  private async hardBreach(w: any): Promise<void> {
    const oldStatus = w.status;

    await this.withdrawService.updateStatus(
      w.id,
      {
        action: WithdrawTransactionAction.SLA_BREACH,
        reason: 'SLA breached: no compliance action before deadline',
      },
      {
        source: 'SYSTEM',
        actorType: 'SYSTEM',
        actorId: 'SLA_TIMER',
        sourcePlatform: 'SYSTEM',
        // ⚠️ 刻意不传 slaBreached —— 进入 MANUAL_CHECKING 时收口处会设一个新的
        // 软计时器并把 slaBreached 归 false；这里若传 true 会把它覆盖回去，
        // 新计时器一出生就被标成「已破线」、永远扫不到。
        // 防重复扫由状态变化本身保证：新 deadline 在未来，不再匹配 slaDeadline < now。
      },
    );

    this.logger.warn(
      `Withdrawal ${w.id} SLA breached (was ${oldStatus}, deadline ${w.slaDeadline?.toISOString?.() ?? w.slaDeadline}) → MANUAL_CHECKING`,
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SLA_BREACHED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `SLA breached: withdrawal was ${oldStatus} past its slaDeadline, routed to manual review`,
      metadata: { slaType: 'HARD', fromStatus: oldStatus, slaDeadline: w.slaDeadline },
      sourcePlatform: 'SYSTEM',
    });
  }
}
