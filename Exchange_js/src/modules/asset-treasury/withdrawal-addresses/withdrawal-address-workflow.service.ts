import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
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
    // 三轴收敛：原先「onboardingStatus===APPROVED 且 adminStatus===ACTIVE」两判
    // 现在就是 lifecycle==='ACTIVE' 一条。⚠️ 这里 prisma 走 `as any`，编译期看不见
    // 字段删除 —— 不改的话读到的是 undefined，两个判断恒真、任何客户都建不了提现地址。
    if (customer.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' });
    }

    const asset = await (this.prisma as any).asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }
    if (asset.type !== 'CRYPTO') {
      throw new BadRequestException({ code: 'ASSET_NOT_CRYPTO', message: 'Only crypto assets are supported' });
    }

    if (!(await this.addressService.hasActiveFiatWithdrawalAddress(customerId))) {
      throw new ForbiddenException({
        code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
        message: '需要先创建并激活一个法币提现地址才能登记提现地址',
      });
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
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: address.addressNo,
      traceId,
      outcome: AuditOutcome.SUCCESS,
      metadata: { addressType, address: dto.address, network: asset.network, assetCurrency: asset.currency, counterpartyVaspName: attribution.vaspName, label: dto.label },
      sourcePlatform: 'CLIENT_API',
      ownerCustomerNo: customerNo,
    });

    this.logger.log(`Withdrawal address ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  async registerBankAccount(dto: CreateBankAccountDto, customerId: string, customerNo: string) {
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    // 三轴收敛：原先「onboardingStatus===APPROVED 且 adminStatus===ACTIVE」两判
    // 现在就是 lifecycle==='ACTIVE' 一条。⚠️ 这里 prisma 走 `as any`，编译期看不见
    // 字段删除 —— 不改的话读到的是 undefined，两个判断恒真、任何客户都建不了提现地址。
    if (customer.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' });
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
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: address.addressNo,
      traceId,
      outcome: AuditOutcome.SUCCESS,
      metadata: { addressType: 'BANK', iban: maskedIban, bankName: dto.bankName, assetCurrency: asset.currency, skipCooling: address.status === 'ACTIVE' },
      sourcePlatform: 'CLIENT_API',
      ownerCustomerNo: customerNo,
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
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: addressNo,
      traceId: existing.traceId,
      outcome: AuditOutcome.SUCCESS,
      metadata: { cancelledByCustomerNo: customerNo },
      sourcePlatform: 'CLIENT_API',
      ownerCustomerNo: customerNo,
    });

    return result;
  }

  async deactivateAddress(addressNo: string, customerId: string, customerNo: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.deactivate(addressNo, customerId);

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_DEACTIVATED,
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: addressNo,
      traceId: existing.traceId,
      outcome: AuditOutcome.SUCCESS,
      metadata: { deactivatedByCustomerNo: customerNo },
      sourcePlatform: 'CLIENT_API',
      ownerCustomerNo: customerNo,
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
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        traceId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        metadata: { activatedBy },
        sourcePlatform: 'SYSTEM',
        ownerCustomerNo: existing.customerNo,
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
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        traceId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        metadata: { reason, suspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] },
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
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        traceId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        metadata: { skippedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] },
    );

    return result;
  }
}
