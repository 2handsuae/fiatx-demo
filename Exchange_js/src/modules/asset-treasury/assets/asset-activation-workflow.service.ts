import {
  Injectable,
  BadRequestException,
  ConflictException,
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
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { AssetsService } from './assets.service';
import { assertAssetTransition, AssetAction } from './constants/asset-transitions.constant';

const SECONDARY_EVENT = 'workflow.asset-activation.decided';

@Injectable()
export class AssetActivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly registryService: TbAccountRegistryService,
    private readonly assetsService: AssetsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async requestActivation(assetNo: string, actor: ApprovalActorContext) {
    // START：本次激活旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeActivation 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();

    // 1. Find asset, verify PROVISIONING —— 迁移表单一真相源（铁律④）。此前这里
    // 独立维护一份 400 判断，从未触达 assertAssetTransition：Task 29 B7 判据实测
    // 逮到，对 ACTIVE 资产再打本端点拿 400 INVALID_ASSET_STATUS，而不是 409
    // "Invalid transition"——请求层这道守卫绕过了迁移表本身。改走表，非法来源态
    // 由表统一拒绝（409），与 assets.service.ts 三方法、users.domain.service.ts
    // reactivateUser() 同款。
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }
    assertAssetTransition(asset.status, AssetAction.ACTIVATE);

    // 2. Check no pending activation approval
    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_ACTIVATION,
        entityRef: assetNo,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `An activation request is already pending for this asset: ${existingPending.approvalNo}`,
      );
    }

    // 3. Readiness checks
    await this.checkReadiness(asset);

    // 4. Create approval case
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_ACTIVATION,
        entityRef: assetNo,
        traceId: correlationId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCurrency: asset.currency,
          assetType: asset.type,
          network: asset.network,
          tbLedgerId: asset.tbLedgerId,
        },
      },
      {
        reason: `Activate asset: ${asset.currency} (${asset.type})`,
        traceId: correlationId,
      },
      actor,
    );

    // beforeData：请求发起时资产的状态快照（激活只会改 status，其余字段留作上下文）。
    const beforeData = {
      status: asset.status,
      currency: asset.currency,
      type: asset.type,
      network: asset.network,
    };

    // 5. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: 'ASSET_ACTIVATION_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: assetNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        beforeData,
        metadata: {
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_ACTIVATION_REQUESTED_${assetNo}`,
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

  private async checkReadiness(asset: any): Promise<void> {
    // Check 1: TB system accounts exist
    const ledger = asset.tbLedgerId;
    if (!ledger) {
      throw new BadRequestException('Asset has not been provisioned for TigerBeetle');
    }

    const requiredCodes = [
      TB_ACCOUNT_CODES.CLIENT_ASSET,
      TB_ACCOUNT_CODES.FIRM_ASSET,
      TB_ACCOUNT_CODES.FIRM_OPS,
      TB_ACCOUNT_CODES.INCOME_SWAP_FEE,
      TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE,
      TB_ACCOUNT_CODES.INCOME_OTHER,
      ...(asset.type === 'FIAT' ? [TB_ACCOUNT_CODES.FIRM_SET] : []),
    ];

    for (const code of requiredCodes) {
      const account = await this.registryService.resolve({
        code,
        ledger,
        ownerType: 'SYSTEM',
      });
      if (!account) {
        throw new BadRequestException('Asset has not been provisioned for TigerBeetle');
      }
    }

    // Check 2: At least one active wallet
    const walletCount = await this.prisma.wallet.count({
      where: { assetId: asset.id, status: 'ACTIVE' },
    });
    if (walletCount === 0) {
      throw new BadRequestException('No active wallet configured for this asset');
    }
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeActivation(event);
    }
  }

  private async executeActivation(event: ApprovalDecidedEvent) {
    try {
      const assetRecord = await this.prisma.asset.findFirst({ where: { assetNo: event.entityRef } });
      if (!assetRecord || !assetRecord.assetNo) {
        throw new ConflictException(`Asset ${event.entityRef} not found`);
      }

      const updated = await this.assetsService.activateAsset(assetRecord.assetNo);

      await this.auditLogsService.recordSystem({
        action: 'ASSET_ACTIVATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: updated.assetNo ?? undefined,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 requestActivation 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        // 异步驱动：这条记录是被「审批已批准」这个决定触发的。
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        approvalNo: event.approvalNo,
        metadata: {
          activatedByUserId: event.decisionByUserId,
          activatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_ACTIVATION_EXECUTED_${updated.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ASSET_ACTIVATION_FAILED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: error instanceof Error ? error.message : 'Activation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_ACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
