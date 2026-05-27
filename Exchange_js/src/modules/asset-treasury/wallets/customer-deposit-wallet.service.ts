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
import { WalletsService } from './wallets.service';
import * as crypto from 'crypto';

@Injectable()
export class CustomerDepositWalletService {
  private readonly logger = new Logger(CustomerDepositWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletsService: WalletsService,
    @Inject(CUSTODIAN_ADAPTER)
    private readonly custodianAdapter: CustodianAdapter,
  ) {}

  async createOrReturn(customerId: string, assetId: string) {
    // ── Validate customer & asset (reads only, outside tx) ──
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

    // ── H5: Atomic check-then-create inside $transaction (prevents race condition) ──
    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findFirst({
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
        return { kind: 'existing' as const, wallet: existing };
      }

      // Inherit bankName/accountName from CMA for FIAT vIBAN
      let bankName: string | undefined;
      let accountName: string | undefined;
      if (walletRole === WalletRole.C_VIBAN) {
        const cma = await tx.wallet.findFirst({
          where: {
            walletRole: WalletRole.C_CMA,
            assetId,
            status: WalletStatus.ACTIVE,
          },
          select: { bankName: true, accountName: true },
        });
        if (cma) {
          bankName = cma.bankName ?? undefined;
          accountName = cma.accountName ?? undefined;
        }
      }

      // H4: Use WalletsService domain method instead of direct prisma.wallet.create
      const wallet = await this.walletsService.createWalletRecord(
        {
          assetId,
          ownerType: 'CUSTOMER',
          ownerId: customerId,
          ownerNo: customer.customerNo,
          walletRole,
          type: walletType,
          status: 'CREATING',
          bankName,
          accountName,
        },
        tx,
      );

      return { kind: 'created' as const, wallet: wallet! };
    });

    // Short-circuit if existing wallet found
    if (txResult.kind === 'existing') {
      return txResult.wallet;
    }

    const wallet = txResult.wallet;
    const walletNo = wallet.walletNo!; // guaranteed non-null by createWalletRecord
    const traceId = crypto.randomUUID();

    // ── Call custodian adapter (outside tx — external API call) ──
    try {
      const result = await this.custodianAdapter.createVault({
        assetCurrency: asset.currency,
        network: asset.network ?? undefined,
        role: walletRole,
      });

      // H4: Transition via domain method instead of direct prisma.wallet.update
      await this.walletsService.transitionStatus(
        walletNo,
        'CREATING',
        'ACTIVE',
        {
          vaultId: result.vaultId,
          address: result.address ?? null,
          iban: result.iban ?? null,
        },
      );

      // Re-fetch with asset include for API response
      const updated = await this.prisma.wallet.findUnique({
        where: { id: wallet.id },
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
          assetCurrency: asset.currency,
          assetType: asset.type,
          walletRole,
          vaultId: result.vaultId,
          address: result.address,
          iban: result.iban,
        },
        sourcePlatform: 'CLIENT_API',
      });

      this.logger.log(`Deposit wallet ${walletNo} created for customer ${customer.customerNo}, asset ${asset.currency}`);
      return updated;
    } catch (err: any) {
      // H4: Transition to FAILED via domain method instead of direct delete
      try {
        await this.walletsService.transitionStatus(
          walletNo,
          'CREATING',
          'FAILED',
        );
      } catch (transitionErr) {
        this.logger.error(
          `Failed to transition wallet ${walletNo} to FAILED: ${(transitionErr as Error).message}`,
        );
      }

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
          assetCurrency: asset.currency,
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
