import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { AssetProvisioningService } from './asset-provisioning.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const SECONDARY_EVENT = 'workflow.asset-listing.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class AssetListingWorkflowService {
  private readonly logger = new Logger(AssetListingWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly provisioningService: AssetProvisioningService,
  ) {}

  async submitListing(dto: SubmitAssetListingDto, actor: ApprovalActorContext): Promise<any> {
    const traceId = generateReferenceNo('TRC');

    const existing = await this.prisma.asset.findFirst({
      where: { type: dto.type, code: dto.code, network: dto.network ?? null },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ASSET_ALREADY_EXISTS',
        message: `Asset with type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'} already exists`,
      });
    }

    const assetNo = generateReferenceNo('AS');
    const asset = await this.prisma.asset.create({
      data: {
        assetNo,
        type: dto.type,
        code: dto.code,
        network: dto.network,
        decimals: dto.decimals,
        description: dto.description,
        contractAddress: dto.contractAddress,
        minDepositAmount: dto.minDepositAmount,
        maxDepositAmount: dto.maxDepositAmount,
        minWithdrawAmount: dto.minWithdrawAmount,
        maxWithdrawAmount: dto.maxWithdrawAmount,
        depositEnabled: dto.depositEnabled,
        withdrawalEnabled: dto.withdrawalEnabled,
        status: 'PENDING_APPROVAL',
      },
    });

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ASSET_LISTING,
          entityRef: asset.id,
          workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
          workflowId: asset.id,
          workflowNo: assetNo,
          traceId,
          objectSnapshot: { ...dto },
        },
        { reason: `List new asset: ${dto.code} (${dto.type})`, traceId },
        actor,
      );
    } catch (err) {
      await this.prisma.asset.delete({ where: { id: asset.id } });
      throw err;
    }

    await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.LISTING_SUBMITTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{
          subjectRole: AuditSubjectRole.ENTITY,
          subjectType: 'ASSET',
          subjectId: asset.id,
          subjectNo: assetNo,
        }],
        metadata: {
          assetCode: dto.code,
          assetType: dto.type,
          network: dto.network,
          approvalNo: approvalCase.approvalNo,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return { asset, approvalCase };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any): Promise<void> {
    const decision = payload?.decision;
    const entityRef = payload?.entityRef;
    const approvalId = payload?.approvalId;
    const traceId = payload?.traceId;

    if (decision === 'APPROVED') {
      await this.executeProvisioning(entityRef, approvalId, traceId);
    } else {
      await this.executeCancellation(entityRef, traceId);
    }
  }

  private async executeProvisioning(assetId: string, approvalId: string, traceId?: string): Promise<void> {
    try {
      const { tbLedgerId } = await this.provisioningService.provision(assetId);

      await this.approvalsService.markExecutionResult(approvalId, true, SYSTEM_ACTOR);

      const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: assetId,
        entityNo: asset.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { tbLedgerId },
        sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(`Asset provisioning failed for ${assetId}: ${err.message}`, err.stack);
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, err.message);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_PROVISION_FAILED,
        entityType: AuditEntityTypes.ASSET,
        entityId: assetId,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(assetId: string, traceId?: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return;

    await this.prisma.asset.delete({ where: { id: assetId } });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ASSET_LISTING.LISTING_CANCELLED,
      entityType: AuditEntityTypes.ASSET,
      entityId: assetId,
      entityNo: asset.assetNo ?? undefined,
      workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { assetCode: asset.code, assetType: asset.type },
      sourcePlatform: 'SYSTEM',
    });
  }

  async activateAsset(assetNo: string, actor: ApprovalActorContext): Promise<any> {
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }
    if (asset.status !== 'PROVISIONING') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${assetNo} is in ${asset.status} status, expected PROVISIONING`,
      });
    }

    const updated = await this.prisma.asset.update({
      where: { id: asset.id },
      data: { status: 'ACTIVE' },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_ACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        result: AuditResult.SUCCESS,
        metadata: { assetCode: asset.code },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return updated;
  }
}
