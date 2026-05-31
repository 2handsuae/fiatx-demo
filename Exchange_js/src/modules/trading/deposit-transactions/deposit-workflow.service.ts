import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PayinStatusChangedEvent, PayinCreatedEvent } from '../../asset-treasury/payins/events/payin.events';
import {
  PayinStatus,
  PayinAction,
} from '../../asset-treasury/payins/dto/payin.dto';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
  DepositOwnerType,
} from './dto/deposit-transaction.dto';
import { PayinsService } from '../../asset-treasury/payins/payins.service';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);

  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly payinsService: PayinsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
  ) {}

  onModuleInit() {
    this.logger.log('DepositWorkflowService initialized and listening for events.');
  }

  @OnEvent('payin.created')
  async handlePayinCreated(event: PayinCreatedEvent) {
    const { payinId, status } = event;
    this.logger.log(`Orchestrating new PayIn ${payinId} with status ${status}`);

    if (status === PayinStatus.DETECTED) {
      await this.orchestratePayinDetected(payinId);
    }
  }

  @OnEvent('payin.status.changed')
  async handlePayinStatusChanged(event: PayinStatusChangedEvent) {
    const { payinId, newStatus } = event;
    this.logger.log(`Orchestrating PayIn ${payinId} transition to ${newStatus}`);

    switch (newStatus) {
      case PayinStatus.DETECTED:
        await this.orchestratePayinDetected(payinId);
        break;
      case PayinStatus.FAILED:
        await this.orchestratePayinFailed(payinId);
        break;
      case PayinStatus.CONFIRMED:
        await this.orchestratePayinConfirmed(payinId);
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
        await this.executeDepositAccounting(deposit, 'STEP_2');
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
          metadata: { eventCode: 'DEPOSIT_AUDIT_TO_CREDIT', step: 'STEP_2' },
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

  private async orchestratePayinDetected(payinId: string) {
    let deposit = await this.depositService.findByPayinId(payinId);
    if (!deposit) {
      const payin = await this.payinsService.findOne(payinId);
      deposit = await this.depositService.createFromPayin(
        payin.amount.toString(),
        payin.assetId,
        payin.toWalletId,
        payin.txHash || undefined,
        payin.fromAddress || undefined,
        payin.id,
      );
      await this.payinsService.linkDeposit(payinId, deposit.id);

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_CREATED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Deposit created from payin detection',
        metadata: {
          payinId: payin.id,
          amount: payin.amount.toString(),
          assetCurrency: payin.assetId,
          txHash: payin.txHash || null,
        },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async orchestratePayinFailed(payinId: string) {
    const deposit = await this.depositService.findByPayinId(payinId);
    if (
      deposit &&
      deposit.status !== DepositTransactionStatus.FAILED &&
      deposit.status !== DepositTransactionStatus.FROZEN &&
      deposit.status !== DepositTransactionStatus.REJECTED
    ) {
      const oldStatus = deposit.status;
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.FAIL,
        reason: 'PayIn failed',
      });

      await this.recordStateTransitionAudit(updated, oldStatus, updated.status, 'PayIn failed');
    }
  }

  private async orchestratePayinConfirmed(payinId: string) {
    const deposit = await this.depositService.findByPayinId(payinId);
    if (!deposit) return;

    const payin = await this.payinsService.findOne(payinId);
    if (payin.status === PayinStatus.CLEARED) {
      this.logger.debug(`PayIn ${payinId} already CLEARED. Skipping.`);
      return;
    }

    if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING) {
      this.logger.debug(`Deposit ${deposit.id} status ${deposit.status} not eligible for payin_confirmed.`);
      return;
    }

    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        await this.executeDepositAccounting(deposit, 'STEP_1');
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
          metadata: { eventCode: 'DEPOSIT_HOLDING_TO_AUDIT', step: 'STEP_1' },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }
    }

    const updated = await this.depositService.updateStatus(deposit.id, {
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

    await this.payinsService.updateStatus(payinId, PayinAction.CLEAR);

    this.logger.log(`Deposit ${deposit.id} now COMPLIANCE_PENDING. Payin ${payinId} CLEARED.`);
  }

  private async executeDepositAccounting(deposit: any, step: 'STEP_1' | 'STEP_2') {
    const asset = deposit.asset;
    if (!asset) {
      throw new Error(`Deposit ${deposit.id} has no associated asset`);
    }
    if (!asset.tbLedgerId) {
      throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    }

    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);

    if (step === 'STEP_1') {
      // Fiat assets use BANK (code 1), crypto uses CUSTODY (code 10)
      const holdingCode = asset.type === 'FIAT'
        ? TB_ACCOUNT_CODES.BANK
        : TB_ACCOUNT_CODES.CUSTODY;

      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: holdingCode,
        ledger,
        ownerType: 'SYSTEM',
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_AUDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_CUSTODY_TO_AUDIT,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_HOLDING_TO_AUDIT',
          debitCode: String(holdingCode),
          creditCode: String(TB_ACCOUNT_CODES.CLIENT_AUDIT),
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: `Payin confirmed, funds in audit hold (${asset.type === 'FIAT' ? 'BANK' : 'CUSTODY'}→AUDIT)`,
        },
      });

      this.logger.log(`TB Step 1 complete: ${asset.type === 'FIAT' ? 'BANK' : 'CUSTODY'}→CLIENT_AUDIT for deposit ${deposit.depositNo}`);
    } else {
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_AUDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_AUDIT_TO_CREDIT,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_AUDIT_TO_CREDIT',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_AUDIT),
          creditCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Compliance approved, funds credited',
        },
      });

      this.logger.log(`TB Step 2 complete: CLIENT_AUDIT→CLIENT_CREDIT for deposit ${deposit.depositNo}`);
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
