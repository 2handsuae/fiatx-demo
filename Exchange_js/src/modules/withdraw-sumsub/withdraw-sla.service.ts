// src/modules/withdraw-sumsub/withdraw-sla.service.ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SlaSweepBase } from '../sumsub-shared/sla-sweep.base';
import {
  WithdrawTransactionsService,
  WITHDRAW_SLA_SOFT_STATUSES,
} from '../trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawTransactionAction } from '../trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditCategory, AuditSubjectRole } from '../audit-logging/dto/audit-log.dto';
import {
  AuditActions,
  AuditEntityTypes,
} from '../audit-logging/constants/audit-actions.constant';

/**
 * SLA 破线扫描 —— DepositSlaService 的镜像实现（2026-08-21 扩容至硬/软两
 * 类；公共分流逻辑抽到 SlaSweepBase）。扫描 findSlaBreachCandidates 返回的
 * 四个状态，按状态分流：
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
export class WithdrawSlaService extends SlaSweepBase {
  protected readonly domainLabel = 'withdraw';
  protected readonly rowNoun = 'withdrawal';
  protected readonly softStatuses = WITHDRAW_SLA_SOFT_STATUSES;

  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
  ) {
    super();
  }

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.checkSlaBreaches();
  }

  // Core scan logic, kept separate from the @Cron wrapper so it's directly
  // callable in tests without waiting on a real clock.
  async checkSlaBreaches(): Promise<void> {
    await this.sweep(new Date());
  }

  protected async findCandidates(now: Date): Promise<any[]> {
    return this.withdrawService.findSlaBreachCandidates(now);
  }

  protected async markSlaBreached(id: string): Promise<void> {
    await this.withdrawService.markSlaBreached(id);
  }

  /**
   * 软 SLA：等自己人（合规官 / 审批人）超时。只置标记 + 写审计，**状态一步不动**。
   */
  protected async auditSoftBreach(w: any): Promise<void> {
    this.logger.warn(
      `Withdrawal ${w.withdrawNo} soft SLA breached in ${w.status} (deadline ${w.slaDeadline?.toISOString?.() ?? w.slaDeadline}) — flagged only, status unchanged`,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SLA_BREACHED,
      actionDomain: 'WITHDRAW',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      primarySubjectNo: w.withdrawNo,
      ownerCustomerNo: w.customer?.customerNo,
      correlationId: w.correlationId ?? undefined,
      fromStatus: w.status,
      subjects: [
        { subjectType: AuditEntityTypes.WITHDRAW_TRANSACTION, subjectNo: w.withdrawNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(w.customer?.customerNo
          ? [{ subjectType: 'CUSTOMER', subjectNo: w.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
          : []),
      ],
      traceId: w.traceId || undefined,
      reason: `Soft SLA breached in ${w.status} — internal handling overdue, order status intentionally unchanged`,
      metadata: { slaType: 'SOFT', slaDeadline: w.slaDeadline, waitingOn: 'INTERNAL' },
      requestId: `WITHDRAW_SLA_BREACHED_${w.withdrawNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 硬 SLA：等外部（客户交材料 / Sumsub 回裁决）超时。我方有权处置 → 推状态。
   */
  protected async hardBreach(w: any): Promise<void> {
    const oldStatus = w.status;

    const breachedRow = await this.withdrawService.updateStatus(
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
      actionDomain: 'WITHDRAW',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      primarySubjectNo: w.withdrawNo,
      ownerCustomerNo: w.customer?.customerNo,
      correlationId: w.correlationId ?? undefined,
      fromStatus: oldStatus,
      toStatus: breachedRow.status,
      subjects: [
        { subjectType: AuditEntityTypes.WITHDRAW_TRANSACTION, subjectNo: w.withdrawNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(w.customer?.customerNo
          ? [{ subjectType: 'CUSTOMER', subjectNo: w.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
          : []),
      ],
      traceId: w.traceId || undefined,
      reason: `SLA breached: withdrawal was ${oldStatus} past its slaDeadline, routed to manual review`,
      metadata: { slaType: 'HARD', slaDeadline: w.slaDeadline },
      requestId: `WITHDRAW_SLA_BREACHED_${w.withdrawNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }
}
