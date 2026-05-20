import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { TRAVEL_RULE_ADAPTER, TravelRuleAdapter } from './travel-rule-adapter.interface';
import { CreateWithdrawalAddressDto } from './dto/create-withdrawal-address.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import * as crypto from 'crypto';

@Injectable()
export class WithdrawalAddressWorkflowService {
  private readonly logger = new Logger(WithdrawalAddressWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: WithdrawalAddressService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(TRAVEL_RULE_ADAPTER)
    private readonly trAdapter: TravelRuleAdapter,
  ) {}

  async registerAddress(dto: CreateWithdrawalAddressDto, customerId: string, customerNo: string) {
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Customer onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Customer account is not active' });
    }

    const asset = await (this.prisma as any).asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }
    if (asset.type !== 'CRYPTO') {
      throw new BadRequestException({ code: 'ASSET_NOT_CRYPTO', message: 'Only crypto assets are supported' });
    }

    const traceId = crypto.randomUUID();

    const attribution = await this.trAdapter.attributeAddress(dto.address, asset.network ?? '');
    const addressType = attribution.attributed ? 'VASP' : 'SELF_CUSTODY';

    const address = await this.addressService.create({
      customerId,
      customerNo,
      assetId: dto.assetId,
      network: asset.network ?? '',
      address: dto.address,
      addressType,
      label: dto.label,
      beneficiaryName: dto.beneficiaryName,
      memo: dto.memo,
      counterpartyVaspName: attribution.vaspName,
      counterpartyVaspDid: attribution.vaspDid,
      ownershipDeclaredAt: new Date(),
      ownershipProofType: 'DECLARATION',
      traceId,
    });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_REGISTERED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: address.id,
      entityNo: address.addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { addressType, address: dto.address, network: asset.network, assetCurrency: asset.currency, counterpartyVaspName: attribution.vaspName, label: dto.label },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    this.logger.log(`Withdrawal address ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  async registerBankAccount(dto: CreateBankAccountDto, customerId: string, customerNo: string) {
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Customer onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Customer account is not active' });
    }

    const asset = await (this.prisma as any).asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }
    if (asset.type !== 'FIAT') {
      throw new BadRequestException({ code: 'ASSET_NOT_FIAT', message: 'Only fiat assets are supported for bank accounts' });
    }

    const traceId = crypto.randomUUID();

    const address = await this.addressService.createBankAccount({
      customerId,
      customerNo,
      assetId: dto.assetId,
      iban: dto.iban,
      swiftBic: dto.swiftBic,
      bankName: dto.bankName,
      beneficiaryName: dto.beneficiaryName,
      label: dto.label,
      ownershipDeclaredAt: new Date(),
      ownershipProofType: 'DECLARATION',
      traceId,
    });

    const cleanIban = dto.iban.replace(/\s/g, '').toUpperCase();
    const maskedIban = cleanIban.length > 8
      ? `${cleanIban.slice(0, 4)}****${cleanIban.slice(-4)}`
      : cleanIban;

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_REGISTERED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: address.id,
      entityNo: address.addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { addressType: 'BANK', iban: maskedIban, bankName: dto.bankName, assetCurrency: asset.currency },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    this.logger.log(`Bank account ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  async cancelAddress(addressNo: string, customerId: string, customerNo: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.cancel(addressNo, customerId);

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_CANCELLED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: existing.id,
      entityNo: addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId: existing.traceId,
      result: AuditResult.SUCCESS,
      metadata: { cancelledByCustomerNo: customerNo },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    return result;
  }

  async activateAddress(addressNo: string, activatedBy: 'CRON' | 'LAZY' = 'CRON') {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.activate(addressNo);

    if (result.status === 'ACTIVE' && existing.status === 'PENDING_ACTIVATION') {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_ACTIVATED,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        metadata: { activatedBy },
        sourcePlatform: 'SYSTEM',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      });
    }

    return result;
  }

  async suspendAddress(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.suspend(addressNo, actor.userNo, reason);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_SUSPENDED,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        metadata: { reason, suspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role },
    );

    return result;
  }

  /**
   * Activate all addresses whose cooling period has expired for a given customer.
   * Called from controller before listing/detail endpoints.
   * Each activation goes through the workflow's activateAddress (with full audit).
   */
  async batchActivateExpired(customerId: string, assetId?: string): Promise<void> {
    const expired = await this.addressService.findExpiredPendingForCustomer(customerId, assetId);
    for (const addr of expired) {
      try {
        await this.activateAddress(addr.addressNo, 'LAZY');
      } catch (error) {
        // Individual failures are already audit-logged inside activateAddress
        this.logger.warn(`Batch activation failed for ${addr.addressNo}: ${(error as Error).message}`);
      }
    }
  }

  async skipCoolingPeriod(addressNo: string, actor: { userId: string; userNo: string; role: string }) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.skipCooling(addressNo);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.MANUAL_COOLING_SKIP,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        metadata: { skippedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role },
    );

    return result;
  }
}
