import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
  DepositOwnerType,
} from './dto/deposit-transaction.dto';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { deterministicTransferId, bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
  CreateFundsOrderInput,
} from '../../funds-orders/dto/funds-order.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../../deposit-sumsub/sumsub-txn-client.interface';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string;
  fundsOrderNo: string;
  parent: {
    depositTransactionId?: string;
    withdrawTransactionId?: string;
    swapTransactionId?: string;
  };
  legSeq: number;
  attempt: number;
  oldStatus: string | null;
  newStatus: string;
  traceId?: string;
  effectiveDate?: string; // 平账推单回填的业务归属日；普通实时流转恒为 undefined
}

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);

  // A2: system-triggered maker actor for the KYT-verdict-driven RETURN approval.
  // ApprovalActorContext.actorType only accepts 'ADMIN' (mirrors ApprovalsService's own
  // private systemActor() helper) — this is the approvals engine's accepted shape for a
  // SYSTEM-originated maker, not a real admin.
  private static readonly KYT_VERDICT_ACTOR: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'KYT_VERDICT',
    userNo: 'KYT_VERDICT',
    role: 'SYSTEM',
    roleCodes: ['SYSTEM'],
  };

  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    private readonly withdrawalAddresses: WithdrawalAddressService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
    private readonly approvalsService: ApprovalsService,
    private readonly systemWalletResolver: SystemWalletResolver,
    private readonly tbEvidenceService: TbEvidenceService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  onModuleInit() {
    this.logger.log('DepositWorkflowService initialized and listening for events.');
  }

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.depositTransactionId) return; // only payin funds orders
    // A deposit's payin is legSeq 1; the confiscation move hangs a legSeq 2
    // funds order under the SAME deposit. Only leg 1 is the payin — legSeq > 1 is
    // an internal/confiscation leg driven by startConfiscation itself, never a
    // payin, so it must not enter onPayinConfirmed/onPayinFailed. (Mirrors the
    // withdraw workflow branching on PAYOUT_LEG_SEQ vs FEE_LEG_SEQ.)
    // legSeq 2 is the C2/C3 confiscation leg → its CONFIRMED settles the below-min
    // confiscation (POST the two pending legs + deposit → CONFISCATED).
    if (event.legSeq === 2) { await this.onConfiscationLegChanged(event); return; }
    // legSeq 3 is the A3 return-to-sender leg (confiscation owns legSeq 2) →
    // CONFIRMED settles RETURNING → RETURNED; FAILED/TIMEOUT voids + retries.
    if (event.legSeq === 3) { await this.onReturnLegChanged(event); return; }
    if (event.legSeq !== 1) return;
    const depositId = event.parent.depositTransactionId;
    this.logger.log(
      `Deposit ${depositId} funds order ${event.fundsOrderNo} → ${event.newStatus}`,
    );

    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.onPayinConfirmed(depositId, event.fundsOrderId, event.effectiveDate);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onPayinFailed(depositId, event.fundsOrderId);
        break;
    }
  }

  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent) {
    const { depositId, oldStatus, newStatus } = event;
    this.logger.log(
      `Deposit ${depositId} transitioned ${oldStatus} → ${newStatus}`,
    );

    if (newStatus === DepositTransactionStatus.COMPLIANCE_PENDING) {
      await this.runGate0(depositId);
    }
  }

  private async runGate0(depositId: string) {
    const complianceStatus =
      await this.depositService.getOwnerComplianceStatus(depositId);

    if (DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(
        `Gate 0 FAIL: deposit ${depositId} — customer compliance status: ${complianceStatus}`,
      );
      await this.depositService.updateStatus(
        depositId,
        { action: DepositTransactionAction.FREEZE },
        {
          reason: `Customer compliance status: ${complianceStatus}`,
          actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
        },
      );
      return;
    }

    this.logger.log(`Gate 0 PASS: deposit ${depositId}`);

    const deposit = await this.depositService.findOne(depositId);
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_GATE0_PASSED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Gate 0 passed: customer compliance status is normal',
      metadata: { complianceStatus: complianceStatus },
      sourcePlatform: 'SYSTEM',
    });

    try {
      await this.submitSumsubTxns(deposit);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Sumsub submit failed for deposit ${depositId}: ${error.message} — ` +
          `deposit remains COMPLIANCE_PENDING for manual handling/retry; Gate 0 continues`,
      );
    }

    await this.depositService.initializeComplianceGates(depositId);
  }

  /**
   * Gate 0 submission entry: submits the deposit to Sumsub KYT so a verdict webhook
   * can later drive the state machine. Fiat → finance leg only; crypto → finance +
   * travelRule (spec §3). Idempotent on sumsubFinanceTxnId (protects against
   * runGate0 re-entry). If the customer has no sumsubApplicantId yet, warns and
   * skips — the deposit stays in COMPLIANCE_PENDING awaiting manual handling
   * rather than crashing.
   */
  private async submitSumsubTxns(deposit: any): Promise<void> {
    if (deposit.sumsubFinanceTxnId) {
      this.logger.debug(
        `Sumsub submit skip: deposit ${deposit.id} already has sumsubFinanceTxnId (idempotent)`,
      );
      return;
    }

    const applicantId = deposit.customer?.sumsubApplicantId;
    if (!applicantId) {
      this.logger.warn(
        `Sumsub submit skip: deposit ${deposit.id} customer ${deposit.ownerId} has no sumsubApplicantId — staying in COMPLIANCE_PENDING for manual handling`,
      );
      return;
    }

    const isCrypto = deposit.asset?.type === 'CRYPTO';
    const currencyType: 'fiat' | 'crypto' = isCrypto ? 'crypto' : 'fiat';
    const amount = Number(deposit.amount);
    const currencyCode = deposit.asset?.currency;

    const financeResult = await this.sumsubTxnClient.submitTxn({
      applicantId,
      clientTxnId: deposit.depositNo,
      type: 'finance',
      direction: 'in',
      amount,
      currencyCode,
      currencyType,
    });

    const txnIds: { financeTxnId?: string; travelRuleTxnId?: string } = {
      financeTxnId: financeResult.txnId,
    };

    if (isCrypto) {
      const travelRuleResult = await this.sumsubTxnClient.submitTxn({
        applicantId,
        clientTxnId: `${deposit.depositNo}-TR`,
        type: 'travelRule',
        direction: 'in',
        amount,
        currencyCode,
        currencyType,
      });
      txnIds.travelRuleTxnId = travelRuleResult.txnId;
    }

    await this.depositService.setSumsubTxnIds(deposit.id, txnIds);

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Deposit submitted to Sumsub KYT for transaction monitoring',
      metadata: { financeTxnId: txnIds.financeTxnId, travelRuleTxnId: txnIds.travelRuleTxnId },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(
      `Sumsub txn submitted for deposit ${deposit.id}: finance=${txnIds.financeTxnId}` +
        (txnIds.travelRuleTxnId ? `, travelRule=${txnIds.travelRuleTxnId}` : ''),
    );
  }

  // 已终态:进入 applyKytVerdict 时直接 no-op(幂等,防终态后迟到的 webhook)。
  private static readonly KYT_VERDICT_TERMINAL_STATUSES = new Set([
    DepositTransactionStatus.SUCCESS,
    DepositTransactionStatus.REJECTED,
    DepositTransactionStatus.FAILED,
    DepositTransactionStatus.EXPIRED,
    DepositTransactionStatus.CONFISCATED,
    DepositTransactionStatus.RETURNED,
    DepositTransactionStatus.SEIZED,
  ]);

  private static readonly ONHOLD_SLA_DAYS = 7;
  private static readonly ACTION_SLA_DAYS = 7;

  /**
   * Sumsub KYT 裁决落地入口(DepositKytVerdictHandler 调用)。State-aware:
   * 已终态 no-op;已在目标态(重复 webhook)也 no-op。spec §5.1b + 校正(FROZEN 零记账)。
   */
  async applyKytVerdict(
    depositId: string,
    v: {
      verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold';
      sceneTag?: 'SANCTION' | 'PEP';
      dispoTag?: 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER';
    },
  ): Promise<void> {
    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) {
      this.logger.warn(`applyKytVerdict: deposit ${depositId} not found`);
      return;
    }

    const status = deposit.status as DepositTransactionStatus;
    if (DepositWorkflowService.KYT_VERDICT_TERMINAL_STATUSES.has(status)) {
      this.logger.debug(
        `applyKytVerdict no-op: deposit ${depositId} already terminal (${status})`,
      );
      return;
    }

    switch (v.verdict) {
      case 'approved':
        await this.applyKytApproved(deposit);
        return;
      case 'awaitUser':
        await this.applyKytAwaitUser(deposit, v.sceneTag);
        return;
      case 'onHold':
        await this.applyKytOnHold(deposit);
        return;
      case 'rejected':
        await this.applyKytRejected(deposit, v.sceneTag, v.dispoTag);
        return;
    }
  }

  /**
   * Trading-ready 闸(法币提现地址,2026-07-11 不变量):approve 前必须客户已设置 active
   * 法币提现地址,否则原地 hold(不改状态)+ 记 DEPOSIT_HELD_NOT_TRADING_READY 审计。
   * `checkAutoApproval`(老 kyt/tr mock 路径)与 `applyKytApproved`(新 KYT-only 路径)
   * 共享此 helper,消除两路门禁漂移(I1 修复)。
   * 返回 true = trading-ready,调用方可继续;false = 已 hold,调用方须 return。
   */
  private async assertTradingReadyOrHold(deposit: any): Promise<boolean> {
    const ready = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(deposit.ownerId);
    if (ready) return true;

    this.logger.warn(
      `Trading-ready gate hold: deposit ${deposit.id} customer ${deposit.ownerId} not trading-ready (no active fiat withdrawal address)`,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_HELD_NOT_TRADING_READY,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Deposit held: customer has no active fiat withdrawal address (not trading-ready)',
      metadata: { depositNo: deposit.depositNo },
      sourcePlatform: 'SYSTEM',
    });
    return false;
  }

  private async applyKytApproved(deposit: any) {
    const ready = await this.assertTradingReadyOrHold(deposit);
    if (!ready) return;

    if (deposit.status === DepositTransactionStatus.MANUAL_CHECKING) {
      // 误报翻案:此前进了人工复核,官方裁决翻回 approved。记账/SUCCESS 由下面的
      // approveDeposit 统一处理,这里只补一条“翻案”审计。
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_MANUAL_APPROVED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'KYT verdict approved: manual checking overturned',
        sourcePlatform: 'SYSTEM',
      });
    }
    await this.approveDeposit(deposit.id);
  }

  private async applyKytAwaitUser(deposit: any, sceneTag?: 'SANCTION' | 'PEP') {
    if (deposit.status === DepositTransactionStatus.ACTION_PENDING) {
      return; // 已在目标态,防重复 webhook
    }

    const manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION';
    const oldStatus = deposit.status;
    // Minor a 修复:slaDeadline 折进同一次 updateStatus 的 extraData,与 manualReason
    // 一次原子写(避免两步写中间失败,留 ACTION_PENDING 无 slaDeadline 永不被 SLA 扫)。
    const slaDeadline = new Date(
      Date.now() + DepositWorkflowService.ACTION_SLA_DAYS * 24 * 60 * 60 * 1000,
    );
    const updated = await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.ACTION_PENDING,
        reason: 'KYT verdict: awaitUser',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
        sourcePlatform: 'SYSTEM',
        extraData: { manualReason, slaDeadline },
      },
    );

    await this.recordStateTransitionAudit(
      updated,
      oldStatus,
      updated.status,
      `KYT verdict: awaitUser (manualReason=${manualReason})`,
    );
  }

  private async applyKytOnHold(deposit: any) {
    // Minor b 修复:状态守卫——onHold 只对当前在 COMPLIANCE_PENDING 的 deposit 生效。
    // 迟到的 onHold webhook(deposit 已转到 ACTION_PENDING/MANUAL_CHECKING/FROZEN 等其它
    // 状态)no-op,防止重写 slaDeadline + 记多余 DEPOSIT_ONHOLD 审计。
    if (deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
      this.logger.debug(
        `applyKytOnHold no-op: deposit ${deposit.id} not in COMPLIANCE_PENDING (status=${deposit.status}), late onHold webhook ignored`,
      );
      return;
    }

    const slaDeadline = new Date(
      Date.now() + DepositWorkflowService.ONHOLD_SLA_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.depositService.setSlaDeadline(deposit.id, slaDeadline);

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_ONHOLD,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'KYT verdict: onHold, awaiting officer review',
      metadata: { slaDeadline: slaDeadline.toISOString() },
      sourcePlatform: 'SYSTEM',
    });
  }

  private async applyKytRejected(
    deposit: any,
    sceneTag?: 'SANCTION' | 'PEP',
    dispoTag?: 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER',
  ) {
    if (sceneTag === 'SANCTION' || dispoTag === 'FROZEN_BY_MLRO') {
      if (deposit.status === DepositTransactionStatus.FROZEN) return; // 已在目标态,防重复 webhook

      await this.depositService.updateStatus(
        deposit.id,
        { action: DepositTransactionAction.FREEZE, reason: 'KYT verdict: rejected' },
        {
          actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
          sourcePlatform: 'SYSTEM',
        },
      );
      // 校正:FROZEN 零记账——钱留在 DEPOSIT_SUSPENSE,不释放/不过账。
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_FROZEN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: `KYT verdict rejected: ${sceneTag === 'SANCTION' ? 'SANCTION hit' : 'FROZEN_BY_MLRO disposition'}`,
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    if (dispoTag === 'RETURN_TO_SENDER') {
      if (deposit.status === DepositTransactionStatus.RETURNING) return; // 已在目标态,防重复 webhook

      // A2: 不再直推 RETURNING——改开 maker-checker 审批(MLRO 单步),deposit 留
      // MANUAL_CHECKING;批准后的实际结算(出场腿/记账)留 A3(见 initiateReturn/onReturnDecided)。
      try {
        await this.initiateReturn(
          deposit.id,
          { reason: 'KYT verdict rejected: RETURN_TO_SENDER disposition' },
          DepositWorkflowService.KYT_VERDICT_ACTOR,
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          // Minor (A2 review): this catch assumes ConflictException can only come from
          // initiateReturn's own anti-dup guard (an already-open DEPOSIT_RETURN approval)
          // — initiateReturn's only other throw is BadRequestException (wrong status /
          // blank reason), never caught here. If initiateReturn's error surface ever
          // grows a second ConflictException source, this blanket catch would swallow it.
          // 已有一笔在途的退回审批——重复 webhook 命中防重闸,幂等 no-op。
          this.logger.debug(
            `applyKytRejected RETURN_TO_SENDER: deposit ${deposit.id} already has a pending return approval`,
          );
          return;
        }
        throw err;
      }
      return;
    }

    // 无处置 tag → 转人工复核
    if (deposit.status === DepositTransactionStatus.MANUAL_CHECKING) return; // 已在目标态,防重复 webhook

    await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.MANUAL_CHECK,
        reason: 'KYT verdict: rejected, no disposition tag',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
        sourcePlatform: 'SYSTEM',
      },
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_MANUAL_CHECKING,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'KYT verdict rejected: routed to manual compliance review',
      sourcePlatform: 'SYSTEM',
    });
  }

  async applyKytResult(depositId: string, kytStatus: string, riskScore?: number | null) {
    await this.depositService.updateKytStatus(depositId, kytStatus, riskScore);

    const deposit = await this.depositService.findOne(depositId);
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_KYT_APPLIED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: `KYT result applied: ${kytStatus}`,
      metadata: { kytStatus, riskScore: riskScore ?? null },
      sourcePlatform: 'SYSTEM',
    });

    await this.checkAutoApproval(depositId);
  }

  async applyTrResult(depositId: string, trStatus: string) {
    await this.depositService.updateTravelRuleStatus(depositId, trStatus);

    const deposit = await this.depositService.findOne(depositId);
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_TR_APPLIED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: `Travel rule result applied: ${trStatus}`,
      metadata: { trStatus },
      sourcePlatform: 'SYSTEM',
    });

    await this.checkAutoApproval(depositId);
  }

  async checkAutoApproval(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);

    if (deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} status is ${deposit.status}`,
      );
      return;
    }

    if (deposit.limitHoldReason === 'BELOW_MIN') {
      this.logger.warn(`Auto-approval hold: deposit ${depositId} below minimum amount — awaiting ops disposition`);
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_HELD_BELOW_MIN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Deposit held: amount below configured minimum (BELOW_MIN)',
        metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount) },
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    if (deposit.kytStatus !== 'PASSED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} kytStatus=${deposit.kytStatus}`,
      );
      return;
    }

    if (deposit.travelRuleStatus !== 'PASSED' && deposit.travelRuleStatus !== 'NOT_REQUIRED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} travelRuleStatus=${deposit.travelRuleStatus}`,
      );
      return;
    }

    const complianceStatus =
      await this.depositService.getOwnerComplianceStatus(depositId);
    if (DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(
        `Auto-approval skip: deposit ${depositId} customer status=${complianceStatus}`,
      );
      return;
    }

    const ready = await this.assertTradingReadyOrHold(deposit);
    if (!ready) return;

    this.logger.log(
      `All gates PASSED for deposit ${depositId} — auto-approving`,
    );
    await this.approveDeposit(depositId);
  }

  async approveDeposit(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);
    const oldStatus = deposit.status;

    if (
      oldStatus !== DepositTransactionStatus.COMPLIANCE_PENDING &&
      oldStatus !== DepositTransactionStatus.ACTION_PENDING &&
      oldStatus !== DepositTransactionStatus.FROZEN &&
      oldStatus !== DepositTransactionStatus.MANUAL_CHECKING
    ) {
      this.logger.warn(`Deposit ${depositId} in ${oldStatus}, cannot approve.`);
      return;
    }

    // ⑥ DEPOSIT_APPROVED — record before state change
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_APPROVED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Compliance approved, funds credited to client',
      metadata: {
        kytStatus: deposit.kytStatus,
        travelRuleStatus: deposit.travelRuleStatus,
        oldStatus,
      },
      sourcePlatform: 'SYSTEM',
    });

    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        const [payinFundsOrder] = await this.fundsOrders.findByParent(
          { depositTransactionId: deposit.id },
          { legSeq: 1 },
        );
        await this.executeDepositAccounting(deposit, 'STEP_2', payinFundsOrder);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`TB Step 2 failed for deposit ${depositId}: ${error.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id,
          entityNo: deposit.depositNo,
          entityOwnerType: deposit.ownerType,
          entityOwnerId: deposit.ownerId,
          traceId: deposit.traceId || undefined,
          workflowType: 'DEPOSIT',
          result: AuditResult.FAILED,
          reason: `TB Step 2 failed: ${error.message}`,
          metadata: { eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', step: 'STEP_2' },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }
    }

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.APPROVE,
    });

    // ⑦ DEPOSIT_COMPLETED — record after state change
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_COMPLETED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Deposit completed successfully',
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Deposit ${depositId} approved and credited.`);
  }

  async adminReject(
    depositId: string,
    reason: string | undefined,
    actor: { actorId: string; actorRole?: string },
  ) {
    const updated = await this.depositService.updateStatus(
      depositId,
      { action: DepositTransactionAction.REJECT, reason },
      {
        actor: {
          actorType: 'ADMIN',
          actorId: actor.actorId,
          actorRole: actor.actorRole,
        },
        sourcePlatform: 'ADMIN_API',
      },
    );
    await this.recordStateTransitionAudit(
      updated,
      '',
      updated.status,
      reason || 'Admin reject',
    );
    return updated;
  }

  async adminFreeze(
    depositId: string,
    reason: string | undefined,
    actor: { actorId: string; actorRole?: string },
  ) {
    const updated = await this.depositService.updateStatus(
      depositId,
      { action: DepositTransactionAction.FREEZE, reason },
      {
        actor: {
          actorType: 'ADMIN',
          actorId: actor.actorId,
          actorRole: actor.actorRole,
        },
        sourcePlatform: 'ADMIN_API',
      },
    );
    await this.recordStateTransitionAudit(
      updated,
      '',
      updated.status,
      reason || 'Admin freeze',
    );
    return updated;
  }

  /**
   * PASS (waive) disposition: ops waives the amount floor for this one deposit.
   * This does NOT approve/入账 the deposit — it clears the BELOW_MIN hold and
   * re-runs checkAutoApproval so the deposit proceeds through the normal L2
   * compliance gates (KYT/TR/trading-ready). Waiving the amount line does not
   * waive compliance. Single-operator action — no maker-checker.
   */
  async waiveLimitHold(
    depositId: string,
    actor: { actorId: string; actorRole?: string },
  ) {
    const deposit = await this.depositService.findOne(depositId);
    if (
      deposit.limitHoldReason !== 'BELOW_MIN' ||
      deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING
    ) {
      throw new BadRequestException(
        'Deposit has no BELOW_MIN hold to waive',
      );
    }

    await this.depositService.clearLimitHold(depositId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_LIMIT_WAIVED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        result: AuditResult.SUCCESS,
        reason: 'Ops waived below-minimum amount hold (compliance gates still apply)',
        metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount) },
        requestId: `DEPOSIT_LIMIT_WAIVED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      },
    );

    await this.checkAutoApproval(depositId);
  }

  /**
   * CONFISCATE disposition (initiate side): ops proposes taking a below-min deposit
   * as a T&C handling fee. High-risk (moves customer-attributed money to platform
   * revenue) → routed through V1 maker-checker approval (single-step OPS_OFFICER),
   * unlike the single-operator PASS/waive. This only opens the approval case + audits
   * the request; the two-leg posting + status→CONFISCATED lands in D7's decided-event
   * handler (Rule 5: initiate reads only, never writes the deposit table here).
   */
  async initiateConfiscation(
    depositId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Confiscation reason is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (
      deposit.limitHoldReason !== 'BELOW_MIN' ||
      deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING
    ) {
      throw new BadRequestException(
        'Deposit has no BELOW_MIN hold to confiscate',
      );
    }

    // Anti-dup: a deposit must not accrue two open confiscation approvals.
    const openConfiscations = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_CONFISCATION,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openConfiscations.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending confiscation approval; resolve it before submitting another.`,
      );
    }

    // Mint the trace id ONCE and reuse it in both the create and submit DTOs — the
    // approvals engine mints its own id when createDto.traceId is undefined, then asserts
    // create/submit trace consistency, so a recomputed/divergent id (null-traceId path)
    // would reject the whole confiscation. Mirrors transaction-limit initiateCreate/Change.
    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_CONFISCATION,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          basis: 'T&C below-minimum deposit handling fee',
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_CONFISCATION_REQUESTED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_CONFISCATION',
        result: AuditResult.SUCCESS,
        reason: 'Ops requested confiscation of below-minimum deposit as T&C handling fee',
        metadata: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `DEPOSIT_CONFISCATION_REQUESTED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * CONFISCATE disposition (decided side, D7): the V1 approval opened by
   * initiateConfiscation reached a decision. On APPROVED, START the confiscation
   * (two PENDING accounting legs + legSeq 2 funds order CREATED + status→CONFISCATING;
   * the POST/settle half lands in C3). On any other outcome the deposit stays
   * COMPLIANCE_PENDING with its BELOW_MIN hold intact — the approvals engine owns the
   * rejection/cancel/expire audit trail, so this is a clean no-op (idempotent).
   *
   * entityRef is the deposit id. A foreign entityRef (some other workflow's) makes
   * findOne throw NotFound → graceful no-op. An already-CONFISCATED deposit (replayed
   * decided event) → no-op.
   */
  @OnEvent('workflow.deposit-confiscation.decided', { async: true })
  async onConfiscationDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit confiscation decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // entityRef belongs to another workflow's entity — not ours, ignore.
        return;
      }
      throw err;
    }

    // Idempotent replay no-op: both CONFISCATED (settle done) and CONFISCATING (start done,
    // settle in flight) are already-handled states. Without CONFISCATING here, a replayed
    // decided event mid-flight would fall into the drift-precondition guard below and record
    // a MISLEADING "drifted out of confiscable state" FAILED audit for a perfectly healthy move.
    if (
      deposit.status === DepositTransactionStatus.CONFISCATED ||
      deposit.status === DepositTransactionStatus.CONFISCATING
    ) {
      this.logger.debug(`Deposit ${deposit.depositNo} already ${deposit.status} — skipping decided replay.`);
      return;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} confiscation ${event.decision} (case ${event.approvalNo}) — hold intact, no confiscation.`,
      );
      return;
    }

    // Re-assert the confiscable precondition BEFORE posting anything. initiateConfiscation
    // (D6) writes NOTHING to the deposit, so while the approval sat PENDING the deposit
    // stayed mutable — a concurrent waiveLimitHold→approve (→SUCCESS) or adminReject
    // (→REJECTED) can have drifted it out of the confiscable state. Posting the two legs
    // against a SUCCESS/REJECTED deposit would zero CLIENT_ASSET while CLIENT_PAYABLE still
    // owes the customer → phantom liability / double-spend (and the negative suspense would
    // net the L/E identity, hiding it from recon). Guard: post NO legs, create NO funds
    // order, change NO status when drifted — just leave an audit trail for ops.
    if (
      deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING ||
      deposit.limitHoldReason !== 'BELOW_MIN'
    ) {
      this.logger.warn(
        `Confiscation skipped: deposit ${deposit.depositNo} no longer confiscable ` +
          `(status=${deposit.status}, hold=${deposit.limitHoldReason})`,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_CONFISCATION_FAILED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_CONFISCATION',
        result: AuditResult.FAILED,
        reason:
          'Approved confiscation not executed: deposit drifted out of confiscable state ' +
          '(waived/rejected before approval landed)',
        metadata: { depositNo: deposit.depositNo, status: deposit.status },
        requestId: `DEPOSIT_CONFISCATION_SKIPPED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    await this.startConfiscation(deposit, event.approvalNo);
  }

  /**
   * Start an approved below-min confiscation (two-phase, "start" half). 先账后状态:
   * PENDING-lock BOTH accounting legs + create the legSeq 2 funds order in CREATED
   * (advanceable, NOT auto-cleared), THEN flip the deposit to CONFISCATING via
   * CONFISCATE_START. The matching POST/settle half (funds order → CLEARED, pending
   * transfers posted, deposit → CONFISCATED) lands in C3's settleConfiscation, which
   * reproduces each pending transfer via deterministicTransferId('DEPOSIT',
   * depositNo, eventCode, 1) — so the eventCodes + legIndex here are load-bearing.
   *
   * The two pending legs (same ledger = asset.tbLedgerId):
   *   leg1  DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — exact reverse
   *         of the payin STEP_1; zeroes the customer's suspense.
   *   leg2  DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM) — recognize the handling-fee
   *         income.
   * Neither leg is an external crossing — confiscation reclassifies funds already in
   * the firm's custody; the legSeq 2 funds order (customer deposit wallet → firm F_FEE
   * wallet) is the by-wallet recon anchor for the physical move. Idempotent: reuse an
   * existing legSeq 2 order, and every TB pending id is deterministic so a retry via a
   * new approval re-books without duplicating.
   */
  private async startConfiscation(deposit: any, approvalNo?: string) {
    const asset = deposit.asset;
    if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
    if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const customerWalletRef: string | null = deposit.toWalletId ?? null;
    const firmFeeWallet = await this.systemWalletResolver.resolve(deposit.assetId, 'F_FEE');

    const [existing] = await this.fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 2 });
    if (!existing) {
      await this.fundsOrders.create({
        depositTransactionId: deposit.id,
        legSeq: 2,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: deposit.assetId,
        amount: String(deposit.amount),
        netAmount: String(deposit.amount),
        fromWalletId: deposit.toWalletId ?? null,
        fromAddress: deposit.toAddress ?? undefined,
        fromIban: deposit.toIban ?? undefined,
        toWalletId: firmFeeWallet.id,
        toAddress: firmFeeWallet.address ?? undefined,
        toIban: firmFeeWallet.iban ?? undefined,
        traceId: deposit.traceId || undefined,
      });
    }

    const suspenseId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId });
    const clientAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const firmAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' });
    const firmFeeId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_FEE, ledger, ownerType: 'SYSTEM' });

    await this.accountingService.executePendingTransfer({
      debitAccountId: suspenseId, creditAccountId: clientAssetId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET, timeout: 0, legIndex: 1,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_REVERSE_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: 'Below-min confiscation reverse suspense (pending)', debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: false,
      },
    });
    await this.accountingService.executePendingTransfer({
      debitAccountId: firmAssetId, creditAccountId: firmFeeId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE, timeout: 0, legIndex: 1,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_FIRM_FEE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: 'Below-min confiscation fee income (pending)', debitWalletRef: null, creditWalletRef: firmFeeWallet.id, isExternalCrossing: false,
      },
    });

    await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_START, reason: 'Below-min confiscation started (funds in transit)' });

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_CONFISCATION_STARTED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
      metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount), approvalNo },
      requestId: `DEPOSIT_CONFISCATION_STARTED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * Confiscation settle half (C3): the legSeq 2 funds order reached a status. Ops advancing
   * the leg to CONFIRMED is the trigger to POST both pending legs and land the deposit in
   * CONFISCATED. Non-CONFIRMED statuses (SUBMITTED/…) are ignored. Idempotent: only a deposit
   * still CONFISCATING is in flight — an already-CONFISCATED one (or one that never entered
   * confiscation) is a no-op, so a replayed CONFIRMED never double-settles.
   */
  private async onConfiscationLegChanged(event: FundsOrderStatusChangedEvent) {
    if (event.newStatus !== FundsOrderStatus.CONFIRMED) return; // only settle on CONFIRMED
    const depositId = event.parent.depositTransactionId;
    if (!depositId) return;
    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.CONFISCATING) return; // already settled / not in transit
    await this.settleConfiscation(deposit, event.fundsOrderId);
  }

  /**
   * POST the two pending confiscation legs C2 locked (先账后状态), then flip the deposit to
   * CONFISCATED. Each pending id is reproduced deterministically from the SAME business key
   * C2 used — deterministicTransferId('DEPOSIT', depositNo, eventCode, 1) — so the eventCodes +
   * legIndex(=1) MUST match startConfiscation exactly (leg1 CONFISCATE_REVERSE_SUSPENSE, leg2
   * CONFISCATE_FIRM_FEE). 3× retry on a transient TB failure; if every attempt fails the deposit
   * stays CONFISCATING (no revert, no rethrow — silent stop in the async listener) with a
   * DEPOSIT_CONFISCATION_FAILED audit flagging it for manual intervention.
   */
  private async settleConfiscation(deposit: any, fundsOrderId: string) {
    const asset = deposit.asset;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const pend1 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_REVERSE_SUSPENSE', 1);
    const pend2 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_FIRM_FEE', 1);
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        // leg1: DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — reverse the payin suspense.
        await this.accountingService.postPendingTransfer({
          pendingTransferId: pend1, amount: amountBigint,
          evidence: {
            sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_REVERSE_SUSPENSE',
            debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
            assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
          },
        });
        // leg2: DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM) — recognize the handling-fee income.
        await this.accountingService.postPendingTransfer({
          pendingTransferId: pend2, amount: amountBigint,
          evidence: {
            sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_FIRM_FEE',
            debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE],
            assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
          },
        });
        await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_SETTLE, reason: 'Below-min confiscation settled' });
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_CONFISCATION_EXECUTED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
          workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
          metadata: { depositNo: deposit.depositNo, fundsOrderId }, requestId: `DEPOSIT_CONFISCATION_EXECUTED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
        });
        return;
      } catch (err: any) {
        this.logger.error(`Confiscation settle attempt ${attempt}/${MAX} for ${deposit.depositNo} failed: ${err.message}`);
        if (attempt === MAX) {
          await this.auditLogsService.recordSystem({
            action: AuditActions.DEPOSIT_CONFISCATION_FAILED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
            entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
            workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
            reason: `Settle failed after ${MAX} retries — manual intervention required (deposit stays CONFISCATING)`,
            metadata: { depositNo: deposit.depositNo, fundsOrderId, error: err.message }, requestId: `DEPOSIT_CONFISCATION_FAILED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
          });
          return; // stay CONFISCATING, no revert, no rethrow (silent stop in the async listener)
        }
      }
    }
  }

  private async onPayinFailed(depositId: string, fundsOrderId: string) {
    const deposit = await this.depositService.findOne(depositId);
    if (
      deposit &&
      deposit.status !== DepositTransactionStatus.FAILED &&
      deposit.status !== DepositTransactionStatus.FROZEN &&
      deposit.status !== DepositTransactionStatus.REJECTED
    ) {
      const oldStatus = deposit.status;
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.FAIL,
        reason: 'Payin funds order failed',
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_PAYIN_FAILED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Payin funds order failed',
        metadata: { fundsOrderId },
        sourcePlatform: 'SYSTEM',
      });

      await this.recordStateTransitionAudit(updated, oldStatus, updated.status, 'Payin funds order failed');
    }
  }

  private async onPayinConfirmed(depositId: string, fundsOrderId: string, effectiveDate?: string) {
    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) return;

    const fundsOrder = await this.fundsOrders.findById(fundsOrderId);
    if (fundsOrder && fundsOrder.status === FundsOrderStatus.CLEARED) {
      this.logger.debug(`Funds order ${fundsOrderId} already CLEARED. Skipping.`);
      return;
    }

    if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING) {
      this.logger.debug(`Deposit ${deposit.id} status ${deposit.status} not eligible for payin_confirmed.`);
      return;
    }

    // ── DEPOSIT_PAYIN_CONFIRMED — record before posting/state change ──
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_PAYIN_CONFIRMED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Payin funds order confirmed',
      metadata: { fundsOrderId, fundsOrderNo: fundsOrder?.fundsOrderNo ?? null },
      sourcePlatform: 'SYSTEM',
    });

    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        await this.executeDepositAccounting(deposit, 'STEP_1', fundsOrder, effectiveDate);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`TB Step 1 failed for deposit ${deposit.id}: ${error.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id,
          entityNo: deposit.depositNo,
          entityOwnerType: deposit.ownerType,
          entityOwnerId: deposit.ownerId,
          traceId: deposit.traceId || undefined,
          workflowType: 'DEPOSIT',
          result: AuditResult.FAILED,
          reason: `TB Step 1 failed: ${error.message}`,
          metadata: { eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE', step: 'STEP_1' },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }
    }

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.PAYIN_CONFIRMED,
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_COMPLIANCE_STARTED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Payin confirmed, deposit entering compliance review',
      sourcePlatform: 'SYSTEM',
    });

    await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');

    this.logger.log(`Deposit ${deposit.id} now COMPLIANCE_PENDING. Funds order ${fundsOrderId} CLEARED.`);
  }

  private async executeDepositAccounting(
    deposit: any,
    step: 'STEP_1' | 'STEP_2',
    fundsOrder?: any,
    effectiveDate?: string,
  ) {
    const asset = deposit.asset;
    if (!asset) {
      throw new Error(`Deposit ${deposit.id} has no associated asset`);
    }
    if (!asset.tbLedgerId) {
      throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    }

    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);

    // Phase B per-physical-wallet recon: the deposit's payin funds_order pins the
    // specific wallet that received the funds. Falls back to the deposit's own
    // toWalletId when the funds_order isn't passed.
    const walletRef: string | null =
      fundsOrder?.toWalletId ?? deposit.toWalletId ?? null;
    // externalRef 归 funds_order 所有(CONFIRMED 时按资产类型铸)。STEP_1 是外部穿越腿,
    // 读单一源,不再本地 coalesce。STEP_2(下方)是纯重分类,保持 externalRef:null。
    const externalRef: string | null = fundsOrder
      ? this.fundsOrders.resolveExternalRef(fundsOrder)
      : null;

    if (step === 'STEP_1') {
      // Real-time 1:1: debit the aggregate CLIENT_ASSET (SYSTEM), credit DEPOSIT_SUSPENSE (CUSTOMER)
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_ASSET,
        ledger,
        ownerType: 'SYSTEM',
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Payin confirmed, funds in compliance hold (CLIENT_ASSET→DEPOSIT_SUSPENSE)',
          // Phase B: inbound real-world recognition — both aggregate (CLIENT_ASSET) and
          // SUSPENSE legs reference the specific wallet that received the on-chain / bank inbound.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef,
          isExternalCrossing: true,
          ...(effectiveDate && { effectiveDate }),
        },
      });

      this.logger.log(`TB Step 1 complete: CLIENT_ASSET→DEPOSIT_SUSPENSE for deposit ${deposit.depositNo}`);
    } else {
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Compliance approved, funds credited to client payable',
          // Phase B: pure ledger reclass — money doesn't move physically, both legs sit on the same wallet,
          // no external statement entry, not a real-world crossing.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef: null,
          isExternalCrossing: false,
          ...(effectiveDate && { effectiveDate }),
        },
      });

      this.logger.log(`TB Step 2 complete: DEPOSIT_SUSPENSE→CLIENT_PAYABLE for deposit ${deposit.depositNo}`);
    }
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  private async recordStateTransitionAudit(
    deposit: any,
    fromStatus: string,
    toStatus: string,
    reason: string,
  ) {
    await this.auditLogsService.recordSystem({
      action: buildStateTransitionAction('DEPOSIT', fromStatus, toStatus),
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason,
      sourcePlatform: 'SYSTEM',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A2 — RETURN / SEIZE / UNFREEZE maker-checker approval gates (计划2).
  // Each initiate* mirrors initiateConfiscation's structure exactly: reads the
  // deposit, checks a precondition + an open-approval anti-dup guard, opens the
  // V1 approval case, audits the request — and writes NOTHING to the deposit
  // table (Rule 5: initiate reads only). Each on*Decided listener mirrors
  // onConfiscationDecided's routing (APPROVED → execute, else → audit trail
  // already owned by the approvals engine, deposit stays put) but the "execute"
  // side is a stub for this task — real settlement (out-leg posting, status
  // transitions) lands in A3 (return) / A4 (seize) / A5 (unfreeze).
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * RETURN disposition (initiate side, A2): KYT verdict says RETURN_TO_SENDER while the
   * deposit sits in MANUAL_CHECKING. High-risk (moves customer money back out) → routed
   * through V1 maker-checker approval (single-step MLRO). Only opens the approval case +
   * audits the request; the actual return leg posting + status→RETURNING/RETURNED lands
   * in A3's decided-event handler.
   */
  async initiateReturn(
    depositId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Return reason is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.MANUAL_CHECKING) {
      throw new BadRequestException(
        'Deposit is not awaiting manual review, cannot open a return approval',
      );
    }

    // Anti-dup: a deposit must not accrue two open return approvals.
    const openReturns = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_RETURN,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openReturns.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending return approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_RETURN,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_RETURN_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_RETURN',
        result: AuditResult.SUCCESS,
        reason: dto.reason,
        metadata: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `DEPOSIT_RETURN_APPROVAL_REQUESTED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'SYSTEM',
      },
      this.toAuditActor(actor),
    );

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * SEIZE disposition (initiate side, A2): ops proposes seizing a FROZEN deposit under a
   * government order (asset forfeiture, distinct from the below-min T&C CONFISCATION
   * disposition). High-risk (moves customer-attributed money to government custody) →
   * routed through V1 maker-checker approval (two-step SENIOR_MANAGEMENT_OFFICER → MLRO,
   * four-eyes). Only opens the approval case + audits the request; the actual seize leg
   * posting + status→SEIZING/SEIZED lands in A4's decided-event handler.
   */
  async initiateSeize(
    depositId: string,
    dto: { reason: string; orderRef: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Seize reason is required');
    }
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Government order reference is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      throw new BadRequestException('Deposit is not FROZEN, cannot open a seize approval');
    }

    // Anti-dup: a deposit must not accrue two open seize approvals.
    const openSeizures = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_SEIZE,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openSeizures.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending seize approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_SEIZE,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          orderRef: dto.orderRef,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_SEIZE_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_SEIZE',
        result: AuditResult.SUCCESS,
        reason: dto.reason,
        metadata: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          orderRef: dto.orderRef,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `DEPOSIT_SEIZE_APPROVAL_REQUESTED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * UNFREEZE disposition (initiate side, A2): ops proposes unfreezing a FROZEN deposit
   * under a delisting/unfreeze order (sanction list correction, MLRO clearance, etc.).
   * Routed through V1 maker-checker approval (single-step MLRO). Only opens the approval
   * case + audits the request; the actual resume-into-compliance-flow lands in A5's
   * decided-event handler.
   */
  async initiateUnfreeze(
    depositId: string,
    dto: { reason: string; orderRef: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Unfreeze reason is required');
    }
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Delisting/unfreeze order reference is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      throw new BadRequestException('Deposit is not FROZEN, cannot open an unfreeze approval');
    }

    // Anti-dup: a deposit must not accrue two open unfreeze approvals.
    const openUnfreezes = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_UNFREEZE,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openUnfreezes.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending unfreeze approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_UNFREEZE,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          orderRef: dto.orderRef,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_UNFREEZE_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_UNFREEZE',
        result: AuditResult.SUCCESS,
        reason: dto.reason,
        metadata: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          orderRef: dto.orderRef,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `DEPOSIT_UNFREEZE_APPROVAL_REQUESTED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * RETURN decided (A2): the V1 approval opened by initiateReturn reached a decision.
   * APPROVED → delegate to the onReturnApproved stub (real settlement lands in A3). Any
   * other outcome → the approvals engine already owns the rejection/cancel/expire audit
   * trail; this is a no-op log, deposit stays MANUAL_CHECKING.
   */
  @OnEvent('workflow.deposit-return.decided', { async: true })
  async onReturnDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit return decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // entityRef belongs to another workflow's entity — not ours, ignore.
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} return ${event.decision} (case ${event.approvalNo}) — original state intact, no return executed.`,
      );
      return;
    }

    await this.onReturnApproved(deposit);
  }

  /**
   * Start an approved return-to-sender (A3, "start" half). 先账后状态: PENDING-lock the
   * single reverse-suspense leg + create the legSeq 3 funds order in CREATED
   * (advanceable, NOT auto-cleared) BEFORE flipping the deposit to RETURNING via
   * RETURN. The matching POST/settle half lands in settleReturn, which reproduces
   * the pending transfer via deterministicTransferId('DEPOSIT', depositNo, eventCode,
   * attempt) — so eventCode + legIndex(=attempt) here are load-bearing.
   *
   * Mirrors startConfiscation's structure but with ONE leg, not two: return only
   * reverses the customer's suspense (DR DEPOSIT_SUSPENSE(CUSTOMER) / CR
   * CLIENT_ASSET(SYSTEM) — exact reverse of the payin STEP_1, same direction as
   * confiscation's leg1). Unlike confiscation (an internal reclass), this leg is a
   * genuine external crossing — the funds order's destination is the ORIGINAL
   * SENDER (deposit.fromAddress/fromIban), not a firm wallet, and toWalletId is
   * null (external, not platform-owned). Idempotent: reuse an existing legSeq 3
   * order rather than creating a duplicate on replay.
   *
   * Guarded to only run from MANUAL_CHECKING — a replayed decided event arriving
   * after the deposit already left MANUAL_CHECKING (already RETURNING/RETURNED, or
   * drifted to some other state) is a no-op rather than crashing on an invalid
   * state-machine transition.
   */
  /**
   * Shared legSeq 3 (return-to-sender) funds order creation input — used by both
   * the initial build (onReturnApproved) and the rebuild-on-retry path
   * (onReturnLegFailed). Only `attempt` varies between the two call sites.
   */
  private buildReturnLegInput(deposit: any, attempt: number): CreateFundsOrderInput {
    return {
      depositTransactionId: deposit.id,
      legSeq: 3,
      attempt,
      initialStatus: FundsOrderStatus.CREATED,
      assetId: deposit.assetId,
      amount: String(deposit.amount),
      netAmount: String(deposit.amount),
      fromWalletId: deposit.toWalletId ?? null,
      fromAddress: deposit.toAddress ?? undefined,
      fromIban: deposit.toIban ?? undefined,
      toWalletId: null,
      toAddress: deposit.fromAddress ?? undefined,
      toIban: deposit.fromIban ?? undefined,
      traceId: deposit.traceId || undefined,
    };
  }

  private async onReturnApproved(deposit: any) {
    if (deposit.status !== DepositTransactionStatus.MANUAL_CHECKING) {
      this.logger.debug(
        `onReturnApproved no-op: deposit ${deposit.id} not in MANUAL_CHECKING (status=${deposit.status})`,
      );
      return;
    }

    const [existing] = await this.fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 3 });
    const returnLeg = existing ?? await this.fundsOrders.create(this.buildReturnLegInput(deposit, 1));

    await this.pendReturnSuspense(deposit, returnLeg.attempt ?? 1);

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.RETURN,
      reason: 'Return to sender approved (funds in transit)',
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_RETURN_STARTED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
      metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount), fundsOrderNo: returnLeg.fundsOrderNo },
      requestId: `DEPOSIT_RETURN_STARTED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * Books the single return-leg pending transfer: DR DEPOSIT_SUSPENSE(CUSTOMER) /
   * CR CLIENT_ASSET(SYSTEM), `legIndex: attempt`. `attempt` disambiguates the TB
   * deterministic id across rebuild retries (ExecutePendingTransferParams.legIndex's
   * documented purpose — "distinguish retries of the same (sourceType, sourceNo,
   * eventCode)", the same convention SwapLegAccounting uses for leg self-heal) —
   * without it, a retried leg's pending lock would collide with the voided one from
   * the previous attempt (same deterministic id) and TB would silently no-op it.
   */
  private async pendReturnSuspense(deposit: any, attempt: number): Promise<void> {
    const asset = deposit.asset;
    if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
    if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const customerWalletRef: string | null = deposit.toWalletId ?? null;

    const suspenseId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId });
    const clientAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });

    await this.accountingService.executePendingTransfer({
      debitAccountId: suspenseId, creditAccountId: clientAssetId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_RETURN_PENDING, timeout: 0, legIndex: attempt,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'DEPOSIT_RETURN_PENDING',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: 'Return to sender (pending)', debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: true,
      },
    });
  }

  /**
   * Return-leg settle half: the legSeq 3 funds order reached a status. Mirrors
   * onConfiscationLegChanged's routing but handles BOTH outcomes — the return leg
   * is a genuine external crossing that can fail/timeout (confiscation's internal
   * reclass leg never models this). Idempotent: only a deposit still RETURNING is
   * in flight — an already-RETURNED one (or one that never entered RETURNING) is a
   * no-op, so a replayed event never double-settles or double-retries.
   */
  private async onReturnLegChanged(event: FundsOrderStatusChangedEvent) {
    const depositId = event.parent.depositTransactionId;
    if (!depositId) return;
    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.RETURNING) return; // already settled / not in transit

    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.settleReturn(deposit, event.fundsOrderId, event.attempt);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onReturnLegFailed(deposit, event.fundsOrderId, event.attempt);
        break;
    }
  }

  /**
   * POST the return leg's pending transfer (external payout confirmed), enrich the
   * evidence row with the funds order's externalRef (chain txHash / bank ref, minted
   * at CONFIRMED — mirrors withdraw's onPayoutLegConfirmed → enrichForPost), then
   * flip the deposit to RETURNED. The pending id is reproduced deterministically
   * from the SAME business key pendReturnSuspense used —
   * deterministicTransferId('DEPOSIT', depositNo, 'DEPOSIT_RETURN_PENDING', attempt)
   * — so eventCode + legIndex(=attempt) MUST match exactly. 3× retry on a transient
   * TB failure (mirrors settleConfiscation); if every attempt fails the deposit
   * stays RETURNING (no revert, no rethrow — silent stop in the async listener) with
   * a DEPOSIT_RETURN_STUCK audit flagging it for manual intervention.
   */
  private async settleReturn(deposit: any, fundsOrderId: string, attempt: number) {
    const asset = deposit.asset;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const pend = deterministicTransferId('DEPOSIT', deposit.depositNo, 'DEPOSIT_RETURN_PENDING', attempt);
    const fundsOrder = await this.fundsOrders.findById(fundsOrderId);
    const externalRef = fundsOrder ? this.fundsOrders.resolveExternalRef(fundsOrder) : null;
    const MAX = 3;
    for (let i = 1; i <= MAX; i++) {
      try {
        await this.accountingService.postPendingTransfer({
          pendingTransferId: pend, amount: amountBigint,
          evidence: {
            sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'DEPOSIT_RETURN_PENDING',
            debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
            assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
          },
        });
        // postPendingTransfer only flips transferType — it doesn't write a new evidence
        // row or carry Phase B fields. Enrich the LOCK row so it now records the POST
        // event semantics (new eventCode + externalRef/crossing), mirrors withdraw.
        await this.tbEvidenceService.enrichForPost(bigintToHex(pend), {
          eventCode: 'DEPOSIT_RETURN_POST',
          memo: 'Return to sender confirmed externally',
          externalRef,
          isExternalCrossing: true,
        });
        await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.RETURNED_DONE, reason: 'Return to sender settled' });
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_RETURNED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
          workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
          metadata: { depositNo: deposit.depositNo, fundsOrderId, externalRef },
          requestId: `DEPOSIT_RETURNED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
        });
        return;
      } catch (err: any) {
        this.logger.error(`Return settle attempt ${i}/${MAX} for ${deposit.depositNo} failed: ${err.message}`);
        if (i === MAX) {
          await this.auditLogsService.recordSystem({
            action: AuditActions.DEPOSIT_RETURN_STUCK, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
            entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
            workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
            reason: `Settle failed after ${MAX} retries — manual intervention required (deposit stays RETURNING)`,
            metadata: { depositNo: deposit.depositNo, fundsOrderId, error: err.message }, requestId: `DEPOSIT_RETURN_STUCK_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
          });
          return; // stay RETURNING, no revert, no rethrow (silent stop in the async listener)
        }
      }
    }
  }

  /**
   * The external return payout itself FAILED/TIMED OUT (leg-level failure, distinct
   * from settleReturn's transient-TB-failure retry). VOID the pending lock — the
   * SAME deterministic id reproduced with the failed leg's own `attempt` — then
   * either rebuild a new legSeq 3 attempt (attempt < 3: fresh funds order + fresh
   * pending lock at legIndex=attempt+1, DEPOSIT_RETURN_RETRIED audit) or give up
   * (attempt exhausted: DEPOSIT_RETURN_STUCK audit). Never auto-jumps to a terminal
   * status and never rolls back — the deposit simply stays RETURNING either way,
   * mirroring settleConfiscation's "stop, don't revert" failure semantics.
   */
  private async onReturnLegFailed(deposit: any, fundsOrderId: string, attempt: number) {
    const asset = deposit.asset;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const pend = deterministicTransferId('DEPOSIT', deposit.depositNo, 'DEPOSIT_RETURN_PENDING', attempt);

    await this.accountingService.voidPendingTransfer({
      pendingTransferId: pend, amount: amountBigint,
      evidence: {
        // Note: voidPendingTransfer (like postPendingTransfer) only flips the pending
        // evidence row's transferType — it doesn't currently persist this evidence
        // object. eventCode is set to the VOID label (not the PENDING one used for the
        // hash above) for self-documentation / forward-compat if that ever changes.
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'DEPOSIT_RETURN_VOID',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
      },
    });

    const MAX = 3;
    if (attempt < MAX) {
      const nextAttempt = attempt + 1;
      const newLeg = await this.fundsOrders.create(this.buildReturnLegInput(deposit, nextAttempt));

      await this.pendReturnSuspense(deposit, nextAttempt);

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_RETURN_RETRIED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
        workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
        reason: `Return leg attempt ${attempt} failed — rebuilt attempt ${nextAttempt}`,
        metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt: nextAttempt, fundsOrderNo: newLeg.fundsOrderNo },
        requestId: `DEPOSIT_RETURN_RETRIED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
      });
      return;
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_RETURN_STUCK, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
      reason: `Return leg failed after ${attempt} attempts — manual intervention required (deposit stays RETURNING)`,
      metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt },
      requestId: `DEPOSIT_RETURN_STUCK_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * SEIZE decided (A2): the V1 approval opened by initiateSeize reached a decision.
   * APPROVED → delegate to the onSeizeApproved stub (real settlement lands in A4). Any
   * other outcome → the approvals engine already owns the rejection/cancel/expire audit
   * trail; this is a no-op log, deposit stays FROZEN.
   */
  @OnEvent('workflow.deposit-seize.decided', { async: true })
  async onSeizeDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit seize decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} seize ${event.decision} (case ${event.approvalNo}) — original state intact, no seize executed.`,
      );
      return;
    }

    await this.onSeizeApproved(deposit);
  }

  /** Stub — A4 fills in the actual seize settlement (out-leg posting + status transitions). */
  private async onSeizeApproved(deposit: any) {
    // TODO(A4): post the seize leg(s) (reverse suspense + transfer to FIRM_SEIZED) and
    // drive the deposit status through SEIZING → SEIZED.
    this.logger.log(
      `Deposit ${deposit.depositNo} seize approved — settlement execution deferred to A4.`,
    );
  }

  /**
   * UNFREEZE decided (A2): the V1 approval opened by initiateUnfreeze reached a decision.
   * APPROVED → delegate to the onUnfreezeApproved stub (real resume-into-compliance-flow
   * lands in A5). Any other outcome → the approvals engine already owns the
   * rejection/cancel/expire audit trail; this is a no-op log, deposit stays FROZEN.
   */
  @OnEvent('workflow.deposit-unfreeze.decided', { async: true })
  async onUnfreezeDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit unfreeze decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} unfreeze ${event.decision} (case ${event.approvalNo}) — original state intact, no unfreeze executed.`,
      );
      return;
    }

    await this.onUnfreezeApproved(deposit);
  }

  /** Stub — A5 fills in the actual unfreeze execution (resume into compliance flow). */
  private async onUnfreezeApproved(deposit: any) {
    // TODO(A5): resume the deposit back into the compliance flow (RESUME action →
    // COMPLIANCE_PENDING) and record DEPOSIT_UNFROZEN.
    this.logger.log(
      `Deposit ${deposit.depositNo} unfreeze approved — execution deferred to A5.`,
    );
  }
}
