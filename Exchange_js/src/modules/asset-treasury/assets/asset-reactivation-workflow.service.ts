import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AssetsService } from './assets.service';

const SECONDARY_EVENT = 'workflow.asset-reactivation.decided';

@Injectable()
export class AssetReactivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async requestReactivation(assetNo: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }

    if (asset.status !== 'SUSPENDED') {
      throw new ConflictException(
        `Asset ${assetNo} is not suspended (current: ${asset.status})`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_REACTIVATION,
        entityRef: asset.id,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending reactivation approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_REACTIVATION,
        entityRef: asset.id,
        traceId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCurrency: asset.currency,
          assetType: asset.type,
          network: asset.network,
          currentStatus: asset.status,
          suspendedAt: asset.suspendedAt,
          suspendReason: asset.suspendReason,
        },
      },
      {
        reason: `Reactivate suspended asset: ${asset.currency}`,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_REACTIVATION.REACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCurrency: asset.currency,
          suspendReason: asset.suspendReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_REACTIVATION_REQUESTED_${assetNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      assetNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    try {
      const result = await this.assetsService.reactivateAsset(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_REACTIVATION.ASSET_REACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        entityNo: result.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_REACTIVATION_EXECUTED_${result.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_REACTIVATION.REACTIVATION_EXECUTION_FAILED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_REACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
