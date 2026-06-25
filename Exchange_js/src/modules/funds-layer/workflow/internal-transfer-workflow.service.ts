import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';

export interface InitiateTransferInput {
  fromRole: string;
  toRole: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  assetId: string;
  amount: string;
  fromWalletId: string;
  toWalletId: string;
  triggerSource: string;
  note?: string;
  settlementBatchId?: string | null;
  grossInAmount?: string | null;
  grossOutAmount?: string | null;
}

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
}

/**
 * V7 L3 universal internal-transfer workflow.
 *
 * Orchestrates the funds-layer domain services for any whitelisted internal
 * transfer path: whitelist check → create transfer (domain) → write the
 * REQUESTED journey audit → create the funds-flow execution leg → apply
 * accounting. Subscribes to fundsflow.status.changed to write the terminal
 * COMPLETED / FAILED journey audits.
 */
@Injectable()
export class InternalTransferWorkflowService {
  private readonly logger = new Logger(InternalTransferWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whitelist: WhitelistGuard,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: FundsAccountingService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiate(input: InitiateTransferInput, operatorId = 'SYSTEM') {
    // ── Whitelist gate FIRST, before any DB write / outside the transaction ──
    let policy;
    try {
      policy = this.whitelist.assertWhitelisted(input.fromRole, input.toRole);
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditActions.TRANSFER_WHITELIST_REJECTED,
        entityType: AuditEntityTypes.INTERNAL_TRANSFER,
        workflowType: AuditBusinessWorkflowTypes.INTERNAL_TRANSFER,
        reason: `Rejected non-whitelisted internal transfer path from=${input.fromRole} to=${input.toRole}`,
        metadata: { fromRole: input.fromRole, toRole: input.toRole },
        sourcePlatform: 'SYSTEM',
      });
      throw error;
    }

    return this.prisma.$transaction(async (tx) => {
      const transfer = await this.transfers.createTransfer(
        {
          path: policy.path,
          accountingClass: policy.class,
          medium: policy.medium,
          triggerSource: input.triggerSource,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceNo: input.sourceNo,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          ownerNo: input.ownerNo,
          assetId: input.assetId,
          amount: new Prisma.Decimal(input.amount),
          feeAmount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(input.amount),
          fromWalletId: input.fromWalletId,
          toWalletId: input.toWalletId,
          settlementBatchId: input.settlementBatchId ?? null,
          grossInAmount:
            input.grossInAmount != null ? new Prisma.Decimal(input.grossInAmount) : null,
          grossOutAmount:
            input.grossOutAmount != null ? new Prisma.Decimal(input.grossOutAmount) : null,
        },
        operatorId,
        tx,
      );

      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.REQUESTED,
          entityType: AuditEntityTypes.INTERNAL_TRANSFER,
          entityId: transfer.id,
          entityNo: transfer.internalTxNo || undefined,
          entityOwnerType: input.ownerType,
          entityOwnerId: input.ownerId,
          entityOwnerNo: input.ownerNo || undefined,
          workflowType: AuditBusinessWorkflowTypes.INTERNAL_TRANSFER,
          traceId: transfer.traceId || undefined,
          reason: input.note ?? `Internal transfer requested on path ${policy.path}`,
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        tx,
      );

      await this.fundsFlow.createFromInternalTransaction(
        { internalTransactionId: transfer.id },
        operatorId,
        tx,
      );

      return transfer;
    });
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(_event: FundsFlowStatusChangedEvent) {
    // neutered in Phase A (real-time inline accounting) — remove in Phase C
    // mirrorPhysicalTransfer is deprecated and throws; new flows post TB directly inline.
    return;
  }
}
