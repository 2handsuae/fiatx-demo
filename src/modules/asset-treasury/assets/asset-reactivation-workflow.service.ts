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
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AssetsService } from './assets.service';
import { assertAssetTransition, AssetAction } from './constants/asset-transitions.constant';

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
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async requestReactivation(assetNo: string, actor: ApprovalActorContext) {
    // START：本次复牌旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeReactivation 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }

    assertAssetTransition(asset.status, AssetAction.REACTIVATE);

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_REACTIVATION,
        entityRef: assetNo,
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
        entityRef: assetNo,
        traceId: correlationId,
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
        traceId: correlationId,
      },
      actor,
    );

    await this.assetsService.linkApprovalCase(assetNo, approvalCase.approvalNo);

    // beforeData：请求发起时资产的停牌状态快照（reactivateAsset 会清空这两个字段）。
    const beforeData = {
      status: asset.status,
      suspendedAt: asset.suspendedAt,
      suspendReason: asset.suspendReason,
    };

    await this.auditLogsService.recordByActor(
      {
        action: 'ASSET_REACTIVATION_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: assetNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        beforeData,
        metadata: {
          assetCurrency: asset.currency,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_REACTIVATION_REQUESTED_${assetNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId: correlationId,
      assetNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
    await this.assetsService.clearApprovalCase(event.entityRef);
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    try {
      const assetRecord = await this.prisma.asset.findFirst({ where: { assetNo: event.entityRef } });
      if (!assetRecord) {
        throw new ConflictException(`Asset ${event.entityRef} not found`);
      }

      const result = await this.assetsService.reactivateAsset(assetRecord.id);

      await this.auditLogsService.recordSystem({
        action: 'ASSET_REACTIVATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: result.assetNo ?? undefined,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 requestReactivation 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        // 异步驱动：这条记录是被「审批已批准」这个决定触发的。
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
        approvalNo: event.approvalNo,
        metadata: {
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_REACTIVATION_EXECUTED_${result.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ASSET_REACTIVATION_FAILED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_REACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
