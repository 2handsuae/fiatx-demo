import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
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
    // START：本次创建旅程的 correlationId——同一个值贯穿失败分支（ASSET_CREATION_FAILED）
    // 和成功分支（ASSET_CREATED_AND_PROVISIONED），两分支互斥，各自都是独立一段旅程的起点。
    const correlationId = randomUUID();

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
          action: 'ASSET_CREATION_FAILED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.ASSET,
          correlationId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'EXECUTION_FAILED',
          reason: error instanceof Error ? error.message : 'Asset creation failed',
          metadata: { assetCurrency: dto.currency, assetType: dto.type, network: dto.network },
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: actor.userNo || 'UNKNOWN',
          actorDisplayName: actor.userNo || 'UNKNOWN',
          actorRolesAtTime: [actor.role || 'ADMIN'],
        },
      );

      throw error;
    }

    // 2. Record audit
    // afterData：CREATE 没有「前」态，只存新资产的身份本身——不存 status/id/createdAt 等机械字段。
    const afterData = {
      currency: dto.currency,
      type: dto.type,
      network: dto.network,
      decimals: dto.decimals,
    };

    await this.auditLogsService.recordByActor(
      {
        action: 'ASSET_CREATED_AND_PROVISIONED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: asset.assetNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        afterData,
        metadata: {
          tbLedgerId,
          systemAccountsCreated: 3,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.userNo || 'UNKNOWN',
        actorDisplayName: actor.userNo || 'UNKNOWN',
        actorRolesAtTime: [actor.role || 'ADMIN'],
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

    // afterData：只存本次真正改动的字段（persisted 后的值），不是整份 dto。
    const afterData = Object.fromEntries(fieldsToUpdate.map((k) => [k, (updated as any)[k]]));

    await this.auditLogsService.recordByActor(
      {
        action: 'ASSET_PROVISIONING_UPDATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.ASSET,
        primarySubjectNo: assetNo,
        // INHERIT：同 mfa-binding-workflow.service.ts#findLatestLockAppliedCorrelationId
        // 的「回查最近审计事件取 correlationId」模式——Asset 表没有专属的 correlationId
        // 承载列，provisioning 更新只发生在 PROVISIONING 状态窗口内，回查该 assetNo
        // 最近一条 ASSET_CREATED_AND_PROVISIONED 事件的 correlationId，与创建共享同一段
        // 「上架」旅程。查不到就原样回落 undefined，交给 assertActionSpec 在写入时报错，
        // 不 ?? randomUUID() 冒充 INHERIT。
        correlationId: await this.findCreationCorrelationId(assetNo),
        outcome: AuditOutcome.SUCCESS,
        reason: 'Asset updated during provisioning',
        afterData,
        metadata: { updatedFields: fieldsToUpdate },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.userNo || 'UNKNOWN',
        actorDisplayName: actor.userNo || 'UNKNOWN',
        actorRolesAtTime: [actor.role || 'ADMIN'],
      },
    );

    return { asset: updated };
  }

  private async findCreationCorrelationId(assetNo: string): Promise<string | undefined> {
    const latest = await (this.prisma as any).auditLogEvent.findFirst({
      where: { action: 'ASSET_CREATED_AND_PROVISIONED', primarySubjectNo: assetNo },
      orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }],
      select: { correlationId: true },
    });
    return latest?.correlationId ?? undefined;
  }
}
