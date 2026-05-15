import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AssetProvisioningService } from './asset-provisioning.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async submitListing(dto: SubmitAssetListingDto, actor: AssetCreationActor): Promise<any> {
    // 1. Validate uniqueness
    const existing = await this.prisma.asset.findFirst({
      where: { type: dto.type, code: dto.code, network: dto.network ?? null },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ASSET_ALREADY_EXISTS',
        message: `Asset with type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'} already exists`,
      });
    }

    // 2. Create asset + provision TB accounts in one transaction
    const assetNo = generateReferenceNo('AS');
    let asset: any;
    let tbLedgerId: number;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.asset.create({
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
            status: 'PROVISIONING',
          },
        });

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
          result: AuditResult.FAILED,
          reason: error instanceof Error ? error.message : 'Asset creation failed',
          metadata: { assetCode: dto.code, assetType: dto.type, network: dto.network },
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

    // 3. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_CREATION.ASSET_CREATED_AND_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: dto.code,
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

    // 4. Fire-and-forget: trigger async customer TB account batch creation
    this.eventEmitter.emit('asset.provisioned', {
      assetId: asset.id,
      assetCode: dto.code,
      tbLedgerId,
    });

    return { asset };
  }
}
