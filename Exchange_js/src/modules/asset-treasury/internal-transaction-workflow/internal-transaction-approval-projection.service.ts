import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ApprovalActionTypes,
  ApprovalDecisionEvent,
  ApprovalEvents,
} from '../../governance/approvals/constants/approval.constants';
import { InternalFundsService } from '../internal-funds/internal-funds.service';
import { InternalFundStatus } from '../internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
} from '../internal-transactions/dto/internal-transaction.dto';

@Injectable()
export class InternalTransactionApprovalProjectionService {
  private readonly logger = new Logger(
    InternalTransactionApprovalProjectionService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
  ) {}

  private isTreasuryCrossPoolApproval(event: ApprovalDecisionEvent) {
    return (
      String(event.actionType || '').trim().toUpperCase() ===
      ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL
    );
  }

  private parseDecisionTime(value?: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (!this.isTreasuryCrossPoolApproval(event)) return;

    await (this.prisma as any).$transaction(async (tx: any) => {
      const updated = await this.internalTransactionsService.syncApprovalProjection(
        event.entityRef,
        {
          approvalCaseId: event.approvalId,
          approvalStatus: InternalTransactionApprovalStatus.APPROVED,
          checkerUserId: event.decisionByUserId ?? null,
          checkedAt: this.parseDecisionTime(event.decidedAt),
          reviewReason: event.decisionReason ?? 'Shared approval approved',
        },
        event.decisionByUserId || 'SYSTEM',
        tx,
      );

      await this.internalFundsService.createFromInternalTransaction(
        {
          internalTransactionId: updated.id,
          status: InternalFundStatus.CREATED,
          referenceNo: updated.referenceNo ?? null,
        },
        event.decisionByUserId || 'SYSTEM',
        tx,
      );
    });
    this.logger.log(
      `Treasury cross-pool transfer approved for internal transaction ${event.entityRef}`,
    );
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (!this.isTreasuryCrossPoolApproval(event)) return;

    await this.internalTransactionsService.syncApprovalProjection(
      event.entityRef,
      {
        approvalCaseId: event.approvalId,
        approvalStatus: InternalTransactionApprovalStatus.REJECTED,
        txStatus: InternalTransactionStatus.REJECTED,
        checkerUserId: event.decisionByUserId ?? null,
        checkedAt: this.parseDecisionTime(event.decidedAt),
        reviewReason: event.decisionReason ?? 'Shared approval rejected',
      },
      event.decisionByUserId || 'SYSTEM',
    );
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (!this.isTreasuryCrossPoolApproval(event)) return;

    await this.internalTransactionsService.syncApprovalProjection(
      event.entityRef,
      {
        approvalCaseId: event.approvalId,
        approvalStatus: InternalTransactionApprovalStatus.CANCELLED,
        txStatus: InternalTransactionStatus.CANCELLED,
        checkerUserId: event.decisionByUserId ?? null,
        checkedAt: this.parseDecisionTime(event.decidedAt),
        reviewReason: event.decisionReason ?? 'Shared approval cancelled',
      },
      event.decisionByUserId || 'SYSTEM',
    );
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (!this.isTreasuryCrossPoolApproval(event)) return;

    await this.internalTransactionsService.syncApprovalProjection(
      event.entityRef,
      {
        approvalCaseId: event.approvalId,
        approvalStatus: InternalTransactionApprovalStatus.EXPIRED,
        txStatus: InternalTransactionStatus.EXPIRED,
        checkerUserId: event.decisionByUserId ?? null,
        checkedAt: this.parseDecisionTime(event.decidedAt),
        reviewReason: event.decisionReason ?? 'Shared approval expired',
      },
      event.decisionByUserId || 'SYSTEM',
    );
  }
}
