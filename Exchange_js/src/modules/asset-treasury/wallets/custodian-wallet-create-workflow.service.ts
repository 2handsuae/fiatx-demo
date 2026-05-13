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
import { WalletRole } from './dto/wallet.dto';
import { CreateCustodianWalletDto } from './dto/create-custodian-wallet.dto';
import { getWalletRolePolicy } from './wallet-role-policies.constant';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

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
  ) {}

  async initiateCreate(dto: CreateCustodianWalletDto, actor: ApprovalActorContext) {
    const traceId = generateReferenceNo('TRC');

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
    if (ownerType === 'CUSTOMER' && !dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_ID_REQUIRED',
        message: `ownerId is required for role ${dto.role}`,
      });
    }
    if (ownerType === 'PLATFORM' && dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_MISMATCH',
        message: `Role ${dto.role} is platform-level, ownerId must not be provided`,
      });
    }

    if (ownerType === 'CUSTOMER' && dto.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({ where: { id: dto.ownerId } });
      if (!customer) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${dto.ownerId} not found` });
      }
    }

    const existingCount = await this.prisma.wallet.count({
      where: {
        walletRole: dto.role,
        assetId: asset.id,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
      },
    });
    if (existingCount >= policy.maxPerOwnerPerAsset) {
      throw new BadRequestException({
        code: 'WALLET_ALREADY_EXISTS',
        message: `A ${dto.role} wallet already exists for this asset and owner`,
      });
    }

    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';
    const direction = (dto.role === WalletRole.C_DEP || dto.role === WalletRole.C_VIBAN) ? 'INBOUND' : 'BIDIRECTIONAL';

    const walletNo = generateReferenceNo('WA');
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
        type: walletType,
        direction,
        walletRole: dto.role,
        assetId: asset.id,
        status: 'PENDING_APPROVAL',
      },
    });

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
          entityRef: wallet.id,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          workflowId: wallet.id,
          workflowNo: walletNo,
          traceId,
          objectSnapshot: {
            assetNo: dto.assetNo,
            assetCode: asset.code,
            role: dto.role,
            ownerType,
            ownerId: dto.ownerId || null,
          },
        },
        { reason: `Create ${dto.role} wallet for ${asset.code}`, traceId },
        actor,
      );
    } catch (err) {
      await this.prisma.wallet.delete({ where: { id: wallet.id } });
      throw err;
    }

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.CREATE_REQUESTED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{
          subjectRole: AuditSubjectRole.ENTITY,
          subjectType: 'WALLET',
          subjectId: wallet.id,
          subjectNo: walletNo,
        }],
        metadata: {
          assetNo: dto.assetNo,
          assetCode: asset.code,
          role: dto.role,
          ownerType,
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

    return { wallet: { ...wallet, approvalCaseId: approvalCase.id, approvalCaseNo: approvalCase.approvalNo }, approvalCase };
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
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, 'Wallet not found or wrong status');
      return;
    }

    await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'CREATING' } });

    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
      });

      await this.prisma.wallet.update({
        where: { id: walletId },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
      });

      await this.approvalsService.markExecutionResult(approvalId, true, SYSTEM_ACTOR);

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

      await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'FAILED' } });
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, err.message);

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

    await this.prisma.wallet.delete({ where: { id: walletId } });

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

    const traceId = generateReferenceNo('TRC');
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'CREATING' } });

    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
      });

      const updated = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
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
      await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'FAILED' } });

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
