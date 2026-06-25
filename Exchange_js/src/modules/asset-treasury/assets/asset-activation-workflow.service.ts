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
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { AssetsService } from './assets.service';

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
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async requestActivation(assetNo: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    // 1. Find asset, verify PROVISIONING
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }
    if (asset.status !== 'PROVISIONING') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset must be in PROVISIONING status to activate (current: ${asset.status})`,
      });
    }

    // 2. Check no pending activation approval
    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_ACTIVATION,
        entityRef: asset.id,
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
        entityRef: asset.id,
        traceId,
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
        traceId,
      },
      actor,
    );

    // 5. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_ACTIVATION.ACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCurrency: asset.currency,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_ACTIVATION_REQUESTED_${assetNo}`,
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
      TB_ACCOUNT_CODES.FIRM_FEE,
      TB_ACCOUNT_CODES.FIRM_LIQ,
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
      const assetRecord = await this.prisma.asset.findUnique({ where: { id: event.entityRef } });
      if (!assetRecord || !assetRecord.assetNo) {
        throw new ConflictException(`Asset ${event.entityRef} not found`);
      }

      const updated = await this.assetsService.activateAsset(assetRecord.assetNo);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_ACTIVATION.ASSET_ACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        entityNo: updated.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          activatedByUserId: event.decisionByUserId,
          activatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_ACTIVATION_EXECUTED_${updated.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_ACTIVATION.ACTIVATION_FAILED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Activation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_ACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
