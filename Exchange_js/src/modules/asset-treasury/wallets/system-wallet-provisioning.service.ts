import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { WalletRole } from './dto/wallet.dto';
import { CRYPTO_SYSTEM_WALLET_ROLES, FIAT_SYSTEM_WALLET_ROLES } from './system-wallet.util';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class SystemWalletProvisioningService {
  private readonly logger = new Logger(SystemWalletProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async provisionSystemWallets(
    assetNo: string,
    actor: ApprovalActorContext,
  ): Promise<{ created: any[]; skipped: any[] }> {
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }

    if (asset.status !== 'PROVISIONING' && asset.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${assetNo} is in ${asset.status} status, expected PROVISIONING or ACTIVE`,
      });
    }

    const roles = asset.type === 'FIAT' ? FIAT_SYSTEM_WALLET_ROLES : CRYPTO_SYSTEM_WALLET_ROLES;
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    const created: any[] = [];
    const skipped: any[] = [];

    for (const role of roles) {
      const existing = await this.prisma.wallet.findFirst({
        where: { walletRole: role, assetId: asset.id, ownerType: 'PLATFORM' },
      });

      if (existing) {
        skipped.push({ role, walletNo: existing.walletNo });
        continue;
      }

      const wallet = await this.prisma.wallet.create({
        data: {
          walletNo: generateReferenceNo('WA'),
          ownerType: 'PLATFORM',
          type: walletType,
          direction: 'BIDIRECTIONAL',
          walletRole: role,
          assetId: asset.id,
          status: 'ACTIVE',
          mockBalance: 0,
        },
      });

      created.push({ role, walletNo: wallet.walletNo, walletId: wallet.id });
    }

    this.logger.log(
      `System wallets for ${assetNo}: created=${created.length}, skipped=${skipped.length}`,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.SYSTEM_WALLETS_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        result: AuditResult.SUCCESS,
        metadata: { created, skipped },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return { created, skipped };
  }
}
