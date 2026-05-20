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
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { WalletRole } from './dto/wallet.dto';
import { CreateCustodianWalletDto } from './dto/create-custodian-wallet.dto';
import { getWalletRolePolicy } from './wallet-role-policies.constant';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { WalletsService } from './wallets.service';
import * as crypto from 'crypto';

const SECONDARY_EVENT = 'workflow.custodian-wallet-create.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class CustodianWalletCreateWorkflowService {
  private readonly logger = new Logger(CustodianWalletCreateWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(CUSTODIAN_ADAPTER)
    private readonly custodianAdapter: CustodianAdapter,
    private readonly walletsService: WalletsService,
  ) {}

  async initiateCreate(dto: CreateCustodianWalletDto, actor: ApprovalActorContext) {
    const traceId = crypto.randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo: dto.assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${dto.assetNo} not found` });
    }
    if (asset.status !== 'PROVISIONING' && asset.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${dto.assetNo} is in ${asset.status} status, expected PROVISIONING or ACTIVE`,
      });
    }

    const policy = getWalletRolePolicy(dto.role);
    if (!policy) {
      throw new BadRequestException({ code: 'INVALID_WALLET_ROLE', message: `Unknown wallet role: ${dto.role}` });
    }
    if (!policy.allowedAssetTypes.includes(asset.type)) {
      throw new BadRequestException({
        code: 'ASSET_TYPE_MISMATCH',
        message: `Role ${dto.role} does not support asset type ${asset.type}`,
      });
    }

    const ownerType = policy.allowedOwnerTypes[0];
    if (ownerType === 'CUSTOMER' && !dto.customerNo) {
      throw new BadRequestException({
        code: 'CUSTOMER_NO_REQUIRED',
        message: `customerNo is required for role ${dto.role}`,
      });
    }
    if (ownerType === 'PLATFORM' && dto.customerNo) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_MISMATCH',
        message: `Role ${dto.role} is platform-level, customerNo must not be provided`,
      });
    }

    let customer: { id: string; customerNo: string } | null = null;
    if (ownerType === 'CUSTOMER' && dto.customerNo) {
      customer = await this.prisma.customerMain.findUnique({
        where: { customerNo: dto.customerNo },
        select: { id: true, customerNo: true },
      });
      if (!customer) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${dto.customerNo} not found` });
      }
    }

    const existingCount = await this.prisma.wallet.count({
      where: {
        walletRole: dto.role,
        assetId: asset.id,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : customer?.id,
      },
    });
    if (existingCount >= policy.maxPerOwnerPerAsset) {
      throw new BadRequestException({
        code: 'WALLET_ALREADY_EXISTS',
        message: `A ${dto.role} wallet already exists for this asset and owner`,
      });
    }

    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    // ── bankName / accountName: CMA = required from DTO, vIBAN = inherit from CMA ──
    let bankName: string | undefined;
    let accountName: string | undefined;

    if (dto.role === WalletRole.C_CMA) {
      if (!dto.bankName?.trim()) {
        throw new BadRequestException({
          code: 'BANK_NAME_REQUIRED',
          message: 'bankName is required for C_CMA wallets',
        });
      }
      if (!dto.accountName?.trim()) {
        throw new BadRequestException({
          code: 'ACCOUNT_NAME_REQUIRED',
          message: 'accountName is required for C_CMA wallets',
        });
      }
      bankName = dto.bankName.trim();
      accountName = dto.accountName.trim();
    } else if (dto.role === WalletRole.C_VIBAN) {
      const cma = await this.prisma.wallet.findFirst({
        where: {
          walletRole: WalletRole.C_CMA,
          assetId: asset.id,
          status: 'ACTIVE',
        },
        select: { bankName: true, accountName: true },
      });
      if (!cma) {
        throw new BadRequestException({
          code: 'CMA_NOT_FOUND',
          message: `No active CMA wallet found for asset ${dto.assetNo}. Create the CMA first.`,
        });
      }
      bankName = cma.bankName ?? undefined;
      accountName = cma.accountName ?? undefined;
    }

    const wallet = (await this.walletsService.createWalletRecord({
      assetId: asset.id,
      ownerType,
      ownerId: ownerType === 'PLATFORM' ? undefined : customer?.id,
      ownerNo: ownerType === 'PLATFORM' ? undefined : customer?.customerNo,
      walletRole: dto.role,
      status: 'PENDING_APPROVAL',
      type: walletType,
      vaultId: dto.vaultId,
      iban: dto.iban,
      bankName,
      accountName,
    }))!;
    const walletNo = wallet.walletNo!;

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
          entityRef: wallet.id,
          traceId,
          objectSnapshot: {
            assetNo: dto.assetNo,
            assetCurrency: asset.currency,
            role: dto.role,
            ownerType,
            customerNo: dto.customerNo || null,
            ownerId: customer?.id || null,
            vaultId: dto.vaultId || null,
            iban: dto.iban || null,
            custodianProvider: dto.custodianProvider || null,
          },
        },
        { reason: `Create ${dto.role} wallet for ${asset.currency}`, traceId },
        actor,
      );
    } catch (err) {
      await this.walletsService.deleteWallet(walletNo);
      throw err;
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.CREATE_REQUESTED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetNo: dto.assetNo,
          assetCurrency: asset.currency,
          role: dto.role,
          ownerType,
          customerNo: dto.customerNo || null,
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

    return { wallet, approvalCase };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any): Promise<void> {
    const decision = payload?.decision;
    const entityRef = payload?.entityRef;
    const approvalId = payload?.approvalId;
    const traceId = payload?.traceId;

    if (!approvalId || !entityRef) {
      this.logger.warn('Custodian wallet create decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeCreation(entityRef, approvalId, traceId);
    } else {
      await this.executeCancellation(entityRef, traceId, decision);
    }
  }

  private async executeCreation(walletId: string, approvalId: string, traceId?: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      include: { asset: true },
    });
    if (!wallet || wallet.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`Wallet ${walletId} not found or not in PENDING_APPROVAL status`);
      return;
    }

    // Fiat system wallets with pre-filled IBAN skip adapter — activate directly
    if (wallet.iban) {
      await this.walletsService.transitionStatus(wallet.walletNo!, 'PENDING_APPROVAL', 'ACTIVE', { iban: wallet.iban });

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATED,
        entityType: AuditEntityTypes.WALLET,
        entityId: walletId,
        entityNo: wallet.walletNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { iban: wallet.iban, skipAdapter: true },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Wallet ${wallet.walletNo} activated with pre-filled IBAN ${wallet.iban}`);
      return;
    }

    await this.walletsService.transitionStatus(wallet.walletNo!, 'PENDING_APPROVAL', 'CREATING');

    try {
      const result = await this.custodianAdapter.createVault({
        assetCurrency: wallet.asset.currency,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
        vaultId: wallet.vaultId ?? undefined,
      });

      await this.walletsService.transitionStatus(wallet.walletNo!, 'CREATING', 'ACTIVE', {
        vaultId: result.vaultId,
        address: result.address ?? wallet.address,
        iban: result.iban ?? wallet.iban,
      });

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATED,
        entityType: AuditEntityTypes.WALLET,
        entityId: walletId,
        entityNo: wallet.walletNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { vaultId: result.vaultId, address: result.address, iban: result.iban },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Wallet ${wallet.walletNo} created successfully, vaultId=${result.vaultId}`);
    } catch (err: any) {
      this.logger.error(`Custodian vault creation failed for wallet ${walletId}: ${err.message}`, err.stack);

      await this.walletsService.transitionStatus(wallet.walletNo!, 'CREATING', 'FAILED');

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATE_FAILED,
        entityType: AuditEntityTypes.WALLET,
        entityId: walletId,
        entityNo: wallet.walletNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(walletId: string, traceId?: string, decision?: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;

    await this.walletsService.deleteWallet(wallet.walletNo!);

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.CREATE_CANCELLED,
      entityType: AuditEntityTypes.WALLET,
      entityId: walletId,
      entityNo: wallet.walletNo ?? undefined,
      workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { decision },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Wallet ${wallet.walletNo} creation cancelled (${decision}), row deleted`);
  }

  async retryCreate(walletNo: string, actor: ApprovalActorContext): Promise<any> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { walletNo },
      include: { asset: true },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${walletNo} not found` });
    }
    if (wallet.status !== 'FAILED') {
      throw new BadRequestException({
        code: 'INVALID_WALLET_STATUS',
        message: `Wallet ${walletNo} is in ${wallet.status} status, expected FAILED`,
      });
    }

    const traceId = crypto.randomUUID();
    await this.walletsService.transitionStatus(wallet.walletNo!, 'FAILED', 'CREATING');

    try {
      const result = await this.custodianAdapter.createVault({
        assetCurrency: wallet.asset.currency,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
        vaultId: wallet.vaultId ?? undefined,
      });

      const updated = await this.walletsService.transitionStatus(wallet.walletNo!, 'CREATING', 'ACTIVE', {
        vaultId: result.vaultId,
        address: result.address ?? wallet.address,
        iban: result.iban ?? wallet.iban,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATED,
          entityType: AuditEntityTypes.WALLET,
          entityId: wallet.id,
          entityNo: walletNo,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          traceId,
          result: AuditResult.SUCCESS,
          metadata: { vaultId: result.vaultId, retried: true },
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
    } catch (err: any) {
      await this.walletsService.transitionStatus(wallet.walletNo!, 'CREATING', 'FAILED');

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATE_FAILED,
          entityType: AuditEntityTypes.WALLET,
          entityId: wallet.id,
          entityNo: walletNo,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          traceId,
          result: AuditResult.FAILED,
          metadata: { error: err.message, retried: true },
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: actor.userId,
          actorNo: actor.userNo,
          actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
        },
      );

      throw err;
    }
  }
}
