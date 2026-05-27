import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AssetProvisioningService } from './asset-provisioning.service';
import { AssetsService } from './assets.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

interface AssetCreationActor {
  userId: string;
  userNo?: string;
  role?: string;
}

@Injectable()
export class AssetListingWorkflowService {
  private readonly logger = new Logger(AssetListingWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly provisioningService: AssetProvisioningService,
    private readonly assetsService: AssetsService,
  ) {}

  async submitListing(dto: SubmitAssetListingDto, actor: AssetCreationActor): Promise<any> {
    const traceId = randomUUID();

    // 1. Create asset + provision TB accounts in one transaction
    let asset: any;
    let tbLedgerId: number;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = (await this.assetsService.createAsset({
          currency: dto.currency,
          type: dto.type,
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
        }, tx))!;

        const provisioned = await this.provisioningService.provision(created.id, tx);

        return { asset: { ...created, tbLedgerId: provisioned.tbLedgerId }, tbLedgerId: provisioned.tbLedgerId };
      });

      asset = result.asset;
      tbLedgerId = result.tbLedgerId;
    } catch (error) {
      this.logger.error(`Asset creation + provisioning failed: ${error instanceof Error ? error.message : error}`);

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ASSET_CREATION.ASSET_CREATION_FAILED,
          entityType: AuditEntityTypes.ASSET,
          workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
          traceId,
          result: AuditResult.FAILED,
          reason: error instanceof Error ? error.message : 'Asset creation failed',
          metadata: { assetCurrency: dto.currency, assetType: dto.type, network: dto.network },
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: actor.userId,
          actorNo: actor.userNo,
          actorRole: actor.role || 'ADMIN',
        },
      );

      throw error;
    }

    // 2. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_CREATION.ASSET_CREATED_AND_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: asset.assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCurrency: dto.currency,
          assetType: dto.type,
          network: dto.network,
          tbLedgerId,
          systemAccountsCreated: 3,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || 'ADMIN',
      },
    );

    return { asset };
  }

  /**
   * Update editable fields of a PROVISIONING asset.
   * Identity fields (type, currency, network, decimals) cannot be changed
   * because they are tied to the TB ledger.
   */
  async updateProvisioning(assetNo: string, dto: UpdateAssetDto, actor: AssetCreationActor): Promise<any> {
    const asset = await this.assetsService.findByAssetNo(assetNo);
    if (!asset) {
      throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }

    // Early return if no fields provided
    const fieldsToUpdate = Object.keys(dto).filter(k => (dto as any)[k] !== undefined);
    if (fieldsToUpdate.length === 0) {
      return { asset };
    }

    const updated = await this.assetsService.updateProvisioningFields(assetNo, dto);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_CREATION.ASSET_PROVISIONING_UPDATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
        traceId: randomUUID(),
        result: AuditResult.SUCCESS,
        reason: 'Asset updated during provisioning',
        metadata: { updatedFields: fieldsToUpdate },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || 'ADMIN',
      },
    );

    return { asset: updated };
  }
}
