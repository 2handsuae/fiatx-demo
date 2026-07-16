import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
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

  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    private readonly withdrawalAddresses: WithdrawalAddressService,
    private readonly approvalsService: ApprovalsService,
    private readonly systemWalletResolver: SystemWalletResolver,
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
    // A deposit's payin is legSeq 1; the confiscation move (D7) hangs a legSeq 2
    // funds order under the SAME deposit. Only leg 1 is the payin — legSeq > 1 is
    // an internal/confiscation leg driven by executeConfiscation itself, never a
    // payin, so it must not enter onPayinConfirmed/onPayinFailed. (Mirrors the
    // withdraw workflow branching on PAYOUT_LEG_SEQ vs FEE_LEG_SEQ.)
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

    await this.depositService.initializeComplianceGates(depositId);
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

    const ready = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(deposit.ownerId);
    if (!ready) {
      this.logger.warn(
        `Auto-approval hold: deposit ${depositId} customer ${deposit.ownerId} not trading-ready (no active fiat withdrawal address) — staying in COMPLIANCE_PENDING`,
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
      return;
    }

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
      oldStatus !== DepositTransactionStatus.FROZEN
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
   * initiateConfiscation reached a decision. On APPROVED, execute the confiscation
   * (two accounting legs + funds order + status→CONFISCATED). On any other outcome
   * the deposit stays COMPLIANCE_PENDING with its BELOW_MIN hold intact — the
   * approvals engine owns the rejection/cancel/expire audit trail, so this is a
   * clean no-op (idempotent).
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

    if (deposit.status === DepositTransactionStatus.CONFISCATED) {
      this.logger.debug(`Deposit ${deposit.depositNo} already CONFISCATED — skipping decided replay.`);
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

    await this.executeConfiscation(deposit, event.approvalNo);
  }

  /**
   * Execute an approved below-min confiscation. 先账后状态: book BOTH accounting
   * legs (+ the funds order that represents the physical customer→firm move)
   * SUCCESSFULLY, THEN flip the deposit to CONFISCATED. Any accounting/funds-order
   * failure → audit DEPOSIT_CONFISCATION_FAILED + rethrow, leaving the deposit in
   * COMPLIANCE_PENDING (a new approval can retry — all TB legs use deterministic
   * ids so re-execution is idempotent).
   *
   * The two legs (same ledger = asset.tbLedgerId):
   *   leg1  DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — exact reverse
   *         of the payin STEP_1; zeroes the customer's suspense. Client identity
   *         Σ CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) stays balanced
   *         (both sides −amount).
   *   leg2  DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM) — recognize the handling-fee
   *         income. Firm identity FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+FIRM_FEE+FIRM_LIQ)
   *         stays balanced (both sides +amount).
   * Neither leg is an external crossing — confiscation reclassifies funds already in
   * the firm's custody; the legSeq 2 funds order (customer deposit wallet → firm F_FEE
   * wallet) is the by-wallet recon anchor for the physical move.
   */
  private async executeConfiscation(deposit: any, approvalNo?: string) {
    const requestId = randomUUID();
    try {
      const asset = deposit.asset;
      if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
      if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);

      const ledger = asset.tbLedgerId;
      const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
      const customerWalletRef: string | null = deposit.toWalletId ?? null;

      // Firm destination wallet (fail-closed: no F_FEE wallet → throw → FAILED audit).
      const firmFeeWallet = await this.systemWalletResolver.resolve(deposit.assetId, 'F_FEE');

      // ── Funds order (legSeq 2): the physical customer→firm move representation.
      // Idempotent: reuse an existing legSeq 2 order if a prior partial run created it.
      const [existingLeg] = await this.fundsOrders.findByParent(
        { depositTransactionId: deposit.id },
        { legSeq: 2 },
      );
      let fundsOrder = existingLeg;
      if (!fundsOrder) {
        fundsOrder = await this.fundsOrders.create({
          depositTransactionId: deposit.id,
          legSeq: 2,
          initialStatus: FundsOrderStatus.CONFIRMED,
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
      if (fundsOrder.status !== FundsOrderStatus.CLEARED) {
        await this.fundsOrders.advance(fundsOrder.id, FundsOrderAction.CLEAR, 'SYSTEM');
      }

      // ── Leg 1: DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — reverse STEP_1.
      const suspenseAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });
      const clientAssetAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_ASSET,
        ledger,
        ownerType: 'SYSTEM',
      });
      await this.accountingService.executeTransfer({
        debitAccountId: suspenseAccountId,
        creditAccountId: clientAssetAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'CONFISCATION_REVERSE_SUSPENSE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Below-min confiscation: reverse suspense (DEPOSIT_SUSPENSE→CLIENT_ASSET)',
          // Not an external crossing — suspense reclass on the customer's own wallet.
          debitWalletRef: customerWalletRef,
          creditWalletRef: customerWalletRef,
          externalRef: null,
          isExternalCrossing: false,
        },
      });

      // ── Leg 2: DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM) — recognize fee income.
      const firmAssetAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FIRM_ASSET,
        ledger,
        ownerType: 'SYSTEM',
      });
      const firmFeeAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FIRM_FEE,
        ledger,
        ownerType: 'SYSTEM',
      });
      await this.accountingService.executeTransfer({
        debitAccountId: firmAssetAccountId,
        creditAccountId: firmFeeAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'CONFISCATION_FIRM_FEE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Below-min confiscation: recognize firm fee income (FIRM_ASSET→FIRM_FEE)',
          // FIRM_ASSET is the aggregate pool (no physical wallet); FIRM_FEE sits on
          // the platform F_FEE wallet. Internal recognition — not an external crossing.
          debitWalletRef: null,
          creditWalletRef: firmFeeWallet.id,
          externalRef: null,
          isExternalCrossing: false,
        },
      });

      // ── 先账后状态: only NOW flip the deposit to CONFISCATED (via the service, Rule 5).
      await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.CONFISCATE,
        reason: 'Below-min deposit confiscated as T&C handling fee',
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_CONFISCATION_EXECUTED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT_CONFISCATION',
        result: AuditResult.SUCCESS,
        reason: 'Below-min deposit confiscated: suspense reversed + firm fee recognized',
        metadata: {
          amount: String(deposit.amount),
          assetCurrency: asset.currency,
          basis: 'T&C below-minimum deposit handling fee',
          fundsOrderNo: fundsOrder.fundsOrderNo,
          approvalNo: approvalNo ?? null,
        },
        requestId: `DEPOSIT_CONFISCATION_EXECUTED_${deposit.depositNo}_${requestId}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(
        `Deposit ${deposit.depositNo} CONFISCATED — funds order ${fundsOrder.fundsOrderNo}, two legs posted.`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Confiscation execution failed for deposit ${deposit.depositNo}: ${error.message}`);
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
        reason: `Confiscation execution failed: ${error.message}`,
        metadata: {
          amount: String(deposit.amount),
          assetCurrency: deposit.asset?.currency ?? null,
          approvalNo: approvalNo ?? null,
        },
        requestId: `DEPOSIT_CONFISCATION_FAILED_${deposit.depositNo}_${requestId}`,
        sourcePlatform: 'SYSTEM',
      });
      throw error;
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
}
