// src/modules/deposit-sumsub/deposit-sla.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
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

/**
 * SLA 破线扫描（2026-08-21 扩容至硬/软两类）。扫描 findSlaBreachCandidates
 * 返回的四个状态，按状态分流：
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
export class DepositSlaService {
  private readonly logger = new Logger(DepositSlaService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.checkSlaBreaches();
  }

  // Core scan logic, kept separate from the @Cron wrapper so it's directly
  // callable in tests without waiting on a real clock.
  //
  // 单笔候选单处理失败（含 updateStatus 与 webhook 并发撞车时抛出的 Invalid
  // transition ——对方已经把单子推进了别的状态，是正常的竞态吸收，不是故障）
  // 都不能拖垮整轮扫描：逐笔 try/catch，记录后继续下一单。
  async checkSlaBreaches(): Promise<void> {
    const now = new Date();
    const candidates = await this.depositService.findSlaBreachCandidates(now);

    for (const deposit of candidates) {
      try {
        await this.breach(deposit);
      } catch (err) {
        this.logger.error(
          `deposit SLA sweep failed for deposit ${deposit.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async breach(deposit: any): Promise<void> {
    const oldStatus = deposit.status;

    if (DEPOSIT_SLA_SOFT_STATUSES.has(oldStatus)) {
      await this.softBreach(deposit);
      return;
    }
    await this.hardBreach(deposit);
  }

  /**
   * 软 SLA：等自己人（合规官 / 运营）超时。只置标记 + 写审计，**状态一步不动**。
   */
  private async softBreach(deposit: any): Promise<void> {
    await this.depositService.markSlaBreached(deposit.id);
    this.logger.warn(
      `Deposit ${deposit.depositNo} soft SLA breached in ${deposit.status} (deadline ${deposit.slaDeadline?.toISOString?.() ?? deposit.slaDeadline}) — flagged only, status unchanged`,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SLA_BREACHED,
      primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      primarySubjectNo: deposit.depositNo,
      traceId: deposit.traceId || undefined,
      reason: `Soft SLA breached in ${deposit.status} — internal handling overdue, order status intentionally unchanged`,
      metadata: { slaType: 'SOFT', status: deposit.status, slaDeadline: deposit.slaDeadline, waitingOn: 'INTERNAL' },
      requestId: `DEPOSIT_SLA_BREACHED_${deposit.depositNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 硬 SLA：等外部（客户交材料 / Sumsub 回裁决）超时。我方有权处置 → 推状态。
   */
  private async hardBreach(deposit: any): Promise<void> {
    const oldStatus = deposit.status;
    // 站1b-α：原「客户已交 → 等 provider 重评」理由分支已删——它读的
    // actionSubmittedAt 是从无非空写入方的死列（2026-08-17 材料账迁移后），
    // 分支从未可达（BACKLOG 在案）。列已 drop，理由只剩一种。
    const reason = 'SLA breached: no compliance action before deadline';

    await this.depositService.updateStatus(
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
      primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      primarySubjectNo: deposit.depositNo,
      traceId: deposit.traceId || undefined,
      reason: `${reason} (deposit was ${oldStatus})`,
      metadata: { slaType: 'HARD', fromStatus: oldStatus, slaDeadline: deposit.slaDeadline, waitingOn: 'CUSTOMER' },
      requestId: `DEPOSIT_SLA_BREACHED_${deposit.depositNo}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    });
  }
}
