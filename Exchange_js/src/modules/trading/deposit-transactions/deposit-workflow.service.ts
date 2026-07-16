import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
  ) {}

  onModuleInit() {
    this.logger.log('DepositWorkflowService initialized and listening for events.');
  }

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.depositTransactionId) return; // only payin funds orders
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
