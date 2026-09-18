// src/modules/deposit-sumsub/deposit-sla.service.ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SlaSweepBase } from '../sumsub-shared/sla-sweep.base';
import {
  DepositTransactionsService,
  DEPOSIT_SLA_SOFT_STATUSES,
} from '../trading/deposit-transactions/deposit-transactions.service';
import { DepositTransactionAction } from '../trading/deposit-transactions/dto/deposit-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../audit-logging/dto/audit-log.dto';

/**
 * SLA 破线扫描（2026-08-21 扩容至硬/软两类；公共分流逻辑抽到 SlaSweepBase）。
 * 扫描 findSlaBreachCandidates 返回的四个状态，按状态分流：
 *   硬 SLA（COMPLIANCE_PENDING / ACTION_PENDING，等外部）→ 推 MANUAL_CHECKING
 *   软 SLA（MANUAL_CHECKING / OPERATION_PENDING，等自己人）→ 只置 slaBreached，状态不动
 *
 * deadline 由进入状态时统一设（DepositTransactionsService.resolveSlaFields，
 * 在 updateStatus 等状态机收口处调用），**不再**由任何 webhook 回调设——
 * 尤其不是 DepositWorkflowService.applyKytOnHold（该方法已明确不碰
 * slaDeadline，理由见其 JSDoc）。
 *
 * ⚠️ 不要把 SLA 逻辑再绑回任何 webhook 上。
 */
@Injectable()
export class DepositSlaService extends SlaSweepBase {
  protected readonly domainLabel = 'deposit';
  protected readonly rowNoun = 'deposit';
  protected readonly softStatuses = DEPOSIT_SLA_SOFT_STATUSES;

  constructor(
    private readonly depositService: DepositTransactionsService,
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
    return this.depositService.findSlaBreachCandidates(now);
  }

  protected async markSlaBreached(id: string): Promise<void> {
    await this.depositService.markSlaBreached(id);
  }

  /**
   * 软 SLA：等自己人（合规官 / 运营）超时。只置标记 + 写审计，**状态一步不动**。
   */
  protected async auditSoftBreach(deposit: any): Promise<void> {
    this.logger.warn(
      `Deposit ${deposit.depositNo} soft SLA breached in ${deposit.status} (deadline ${deposit.slaDeadline?.toISOString?.() ?? deposit.slaDeadline}) — flagged only, status unchanged`,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SLA_BREACHED,
      actionDomain: 'DEPOSIT',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      primarySubjectNo: deposit.depositNo,
      ownerCustomerNo: deposit.customer?.customerNo,
      correlationId: deposit.correlationId ?? undefined,
      fromStatus: deposit.status,
      subjects: [
        { subjectType: AuditEntityTypes.DEPOSIT_TRANSACTION, subjectNo: deposit.depositNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(deposit.customer?.customerNo
          ? [{ subjectType: 'CUSTOMER', subjectNo: deposit.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
          : []),
      ],
      traceId: deposit.traceId || undefined,
      reason: `Soft SLA breached in ${deposit.status} — internal handling overdue, order status intentionally unchanged`,
      metadata: { slaType: 'SOFT', slaDeadline: deposit.slaDeadline, waitingOn: 'INTERNAL' },
      requestId: `DEPOSIT_SLA_BREACHED_${deposit.depositNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 硬 SLA：等外部（客户交材料 / Sumsub 回裁决）超时。我方有权处置 → 推状态。
   */
  protected async hardBreach(deposit: any): Promise<void> {
    const oldStatus = deposit.status;
    // 站1b-α：原「客户已交 → 等 provider 重评」理由分支已删——它读的
    // actionSubmittedAt 是从无非空写入方的死列（2026-08-17 材料账迁移后），
    // 分支从未可达（BACKLOG 在案）。列已 drop，理由只剩一种。
    const reason = 'SLA breached: no compliance action before deadline';

    const breachedRow = await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.SLA_BREACH,
        reason,
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'SLA_TIMER' },
        sourcePlatform: 'SYSTEM',
        // ⚠️ 刻意不传 slaBreached —— 进入 MANUAL_CHECKING 时收口处会设一个新的
        // 软计时器并把 slaBreached 归 false；这里若传 true 会把它覆盖回去，
        // 新计时器一出生就被标成「已破线」、永远扫不到。
        // 防重复扫由状态变化本身保证：新 deadline 在未来，不再匹配 slaDeadline < now。
      },
    );

    this.logger.warn(
      `Deposit ${deposit.id} SLA breached (was ${oldStatus}, deadline ${deposit.slaDeadline?.toISOString?.() ?? deposit.slaDeadline}) → MANUAL_CHECKING`,
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SLA_BREACHED,
      actionDomain: 'DEPOSIT',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      primarySubjectNo: deposit.depositNo,
      ownerCustomerNo: deposit.customer?.customerNo,
      correlationId: deposit.correlationId ?? undefined,
      fromStatus: oldStatus,
      toStatus: breachedRow.status,
      subjects: [
        { subjectType: AuditEntityTypes.DEPOSIT_TRANSACTION, subjectNo: deposit.depositNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(deposit.customer?.customerNo
          ? [{ subjectType: 'CUSTOMER', subjectNo: deposit.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
          : []),
      ],
      traceId: deposit.traceId || undefined,
      reason: `${reason} (deposit was ${oldStatus})`,
      metadata: { slaType: 'HARD', slaDeadline: deposit.slaDeadline, waitingOn: 'CUSTOMER' },
      requestId: `DEPOSIT_SLA_BREACHED_${deposit.depositNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }
}
