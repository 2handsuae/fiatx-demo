import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ApprovalActionTypes,
  ApprovalDecisionEvent,
  ApprovalEvents,
} from '../../governance/approvals/constants/approval.constants';
import { PoolSettlementBatchStatus } from './dto/pool-settlement-batch.dto';

@Injectable()
export class PoolSettlementBatchApprovalProjectionService {
  private readonly logger = new Logger(
    PoolSettlementBatchApprovalProjectionService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  private isPoolSettlementBatchApproval(event: ApprovalDecisionEvent) {
    return (
      String(event.actionType || '').trim().toUpperCase() ===
      ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL
    );
  }

  private parseDecisionTime(value?: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async findBatchForProjection(event: ApprovalDecisionEvent) {
    const batch = await (this.prisma as any).poolSettlementBatch.findUnique({
      where: { id: event.entityRef },
      select: {
        id: true,
        batchNo: true,
        approvalCaseId: true,
        status: true,
      },
    });

    if (!batch) {
      return null;
    }

    if (batch.approvalCaseId && batch.approvalCaseId !== event.approvalId) {
      return null;
    }

    if (batch.status !== PoolSettlementBatchStatus.APPROVAL_PENDING) {
      return null;
    }

    return batch;
  }

  private async releaseHeldSources(
    batchId: string,
    terminalStatus: PoolSettlementBatchStatus,
  ) {
    await (this.prisma as any).$transaction(async (tx: any) => {
      await Promise.all([
        tx.outstanding.updateMany({
          where: {
            status: 'OPEN',
            lockedByPoolSettlementBatchId: batchId,
          },
          data: {
            lockedByPoolSettlementBatchId: null,
          },
        }),
        tx.reimbursementObligation.updateMany({
          where: {
            status: 'OPEN',
            lockedByPoolSettlementBatchId: batchId,
          },
          data: {
            lockedByPoolSettlementBatchId: null,
          },
        }),
        tx.poolSettlementBatchItemSource.updateMany({
          where: {
            batchId,
            status: {
              in: ['LINKED', 'NETTED'],
            },
          },
          data: {
            status: 'RELEASED',
            closeReason: 'BATCH_RELEASED',
          },
        }),
      ]);

      await tx.poolSettlementBatch.update({
        where: { id: batchId },
        data: {
          status: terminalStatus,
        },
      });
    });
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await (this.prisma as any).poolSettlementBatch.update({
      where: { id: batch.id },
      data: {
        status: PoolSettlementBatchStatus.APPROVED,
        approvedAt: this.parseDecisionTime(event.decidedAt) || new Date(),
      },
    });

    this.logger.log(`Pool settlement batch approved: ${batch.batchNo || batch.id}`);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.FAILED);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.CANCELLED);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.FAILED);
  }
}
