import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { WalletRole, WalletStatus } from './dto/wallet.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import * as crypto from 'crypto';

@Injectable()
export class CustomerDepositWalletService {
  private readonly logger = new Logger(CustomerDepositWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(CUSTODIAN_ADAPTER)
    private readonly custodianAdapter: CustodianAdapter,
  ) {}

  async createOrReturn(customerId: string, assetId: string) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, onboardingStatus: true, adminStatus: true },
    });
    if (!customer) {
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    }
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }

    const walletRole = asset.type === 'FIAT' ? WalletRole.C_VIBAN : WalletRole.C_DEP;
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    const existing = await this.prisma.wallet.findFirst({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        walletRole,
        status: WalletStatus.ACTIVE,
      },
      include: { asset: { select: { code: true, type: true, decimals: true } } },
    });
    if (existing) {
      return existing;
    }

    const traceId = crypto.randomUUID();
    const walletNo = generateReferenceNo('WA');
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        type: walletType,
        direction: 'INBOUND',
        walletRole,
        assetId,
        status: WalletStatus.CREATING,
      },
    });

    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: asset.code,
        network: asset.network ?? undefined,
        role: walletRole,
      });

      const updated = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: WalletStatus.ACTIVE,
          vaultId: result.vaultId,
          address: result.address ?? null,
          iban: result.iban ?? null,
        },
        include: { asset: { select: { code: true, type: true, decimals: true } } },
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_WALLET_CREATED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customerId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: asset.code,
          assetType: asset.type,
          walletRole,
          vaultId: result.vaultId,
          address: result.address,
          iban: result.iban,
        },
        sourcePlatform: 'CLIENT_API',
      });

      this.logger.log(`Deposit wallet ${walletNo} created for customer ${customer.customerNo}, asset ${asset.code}`);
      return updated;
    } catch (err: any) {
      await this.prisma.wallet.delete({ where: { id: wallet.id } });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_WALLET_CREATE_FAILED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customerId,
        result: AuditResult.FAILED,
        metadata: {
          assetCode: asset.code,
          assetType: asset.type,
          walletRole,
          error: err.message,
        },
        sourcePlatform: 'CLIENT_API',
      });

      this.logger.error(`Deposit wallet creation failed for customer ${customer.customerNo}: ${err.message}`, err.stack);
      throw new BadGatewayException({ code: 'CUSTODIAN_CREATE_FAILED', message: 'Failed to create deposit wallet' });
    }
  }
}
