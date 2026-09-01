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
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AssetsService } from './assets.service';

const SECONDARY_EVENT = 'workflow.asset-suspension.decided';

@Injectable()
export class AssetSuspensionWorkflowService {
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

  async requestSuspension(assetNo: string, reason: string, actor: ApprovalActorContext) {
    // START：本次停牌旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeSuspension 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }

    if (asset.status !== 'ACTIVE') {
      throw new ConflictException(
        `Asset ${assetNo} is not in ACTIVE status (current: ${asset.status})`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_SUSPENSION,
        entityRef: asset.id,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending suspension approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_SUSPENSION,
        entityRef: asset.id,
        traceId: correlationId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCurrency: asset.currency,
          assetType: asset.type,
          network: asset.network,
          currentStatus: asset.status,
          depositEnabled: asset.depositEnabled,
          withdrawalEnabled: asset.withdrawalEnabled,
          reason,
        },
      },
      {
        reason,
        traceId: correlationId,
      },
      actor,
    );

    // beforeData：请求发起时资产的状态快照（suspendAsset 会改 status + 两个 enabled 开关）。
    const beforeData = {
      status: asset.status,
      depositEnabled: asset.depositEnabled,
      withdrawalEnabled: asset.withdrawalEnabled,
    };

    await this.auditLogsService.recordByActor(
      {
        action: 'ASSET_SUSPENSION_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: assetNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        beforeData,
        metadata: {
          assetCurrency: asset.currency,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_SUSPENSION_REQUESTED_${assetNo}`,
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
      return this.executeSuspension(event);
    }
  }

  private async executeSuspension(event: ApprovalDecidedEvent) {
    try {
      const result = await this.assetsService.suspendAsset(
        event.entityRef,
        event.metadata?.reason || 'Approved suspension',
      );

      await this.auditLogsService.recordSystem({
        action: 'ASSET_SUSPENDED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: result.assetNo ?? undefined,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 requestSuspension 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        // 异步驱动：这条记录是被「审批已批准」这个决定触发的。
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        approvalNo: event.approvalNo,
        metadata: {
          suspendedByUserId: event.decisionByUserId,
          suspendedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_SUSPENSION_EXECUTED_${result.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ASSET_SUSPENSION_FAILED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: error instanceof Error ? error.message : 'Suspension execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_SUSPENSION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
