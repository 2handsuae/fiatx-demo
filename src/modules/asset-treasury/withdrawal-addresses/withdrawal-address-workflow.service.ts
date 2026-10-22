import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome, AuditActorContext } from '../../audit-logging/dto/audit-log.dto';
import { WithdrawalAddressService, BANK_RAIL_NETWORK } from './withdrawal-address.service';
import { TRAVEL_RULE_ADAPTER, TravelRuleAdapter, ScreeningAnswer } from './travel-rule-adapter.interface';
import { CreateWithdrawalAddressDto } from './dto/create-withdrawal-address.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
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

  /** 五门：主体层抛的业务拒绝码（其余异常不算「被拦下」，不记） */
  private static readonly DENIED_GATE_CODES: ReadonlySet<string> = new Set([
    'ADDRESS_LIMIT_REACHED',
    'COOLING_PERIOD_NOT_EXPIRED',
    'LAST_ACTIVE_FIAT_ADDRESS',
    'ADDRESS_HAS_INFLIGHT_WITHDRAWAL',
    'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
  ]);

  private customerActor(customerNo: string): AuditActorContext {
    return { actorType: 'CUSTOMER', actorNo: customerNo, actorDisplayName: customerNo, actorRolesAtTime: ['CUSTOMER'] };
  }

  /**
   * 法一·被拦下也留痕：主体层照抛（铁律③ 主体不写审计），这里认出五门的 code 就记一条 DENIED，再原样重抛。
   */
  private async recordDeniedAndRethrow(
    err: unknown,
    ctx: { attempted: string; addressNo?: string; customerNo: string; actor: AuditActorContext; sourcePlatform: 'CLIENT_API' | 'ADMIN_API'; metadata?: Record<string, unknown> },
  ): Promise<never> {
    const body: any = err instanceof HttpException ? err.getResponse() : null;
    const code: string | undefined = body && typeof body === 'object' ? body.code : undefined;
    if (code && WithdrawalAddressWorkflowService.DENIED_GATE_CODES.has(code)) {
      await this.auditLogsService.recordByActor(
        {
          action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
          primarySubjectNo: ctx.addressNo,
          outcome: AuditOutcome.DENIED,
          reasonCode: code,
          reason: `${ctx.attempted} denied: ${body.message ?? code}`,
          metadata: ctx.metadata,
          ownerCustomerNo: ctx.customerNo,
          requestId: `WITHDRAWAL_ADDRESS_REQUEST_DENIED_${ctx.addressNo ?? ctx.customerNo}_${crypto.randomUUID()}`,
          sourcePlatform: ctx.sourcePlatform,
        } as any,
        ctx.actor,
      );
    }
    throw err;
  }

  async registerAddress(dto: CreateWithdrawalAddressDto, customerId: string, customerNo: string) {
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    // 三轴收敛：原先「onboardingStatus===APPROVED 且 adminStatus===ACTIVE」两判
    // 现在就是 lifecycle==='ACTIVE' 一条。⚠️ 这里 prisma 走 `as any`，编译期看不见
    // 字段删除 —— 不改的话读到的是 undefined，两个判断恒真、任何客户都建不了提现地址。
    if (customer.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' });
    }

    const network = assertNetwork(dto.network);
    if (network.kind !== 'CHAIN') {
      throw new BadRequestException({ code: 'NETWORK_NOT_CHAIN', message: 'Only chain networks accept on-chain addresses' });
    }

    if (!(await this.addressService.hasActiveFiatWithdrawalAddress(customerId))) {
      await this.recordDeniedAndRethrow(
        new ForbiddenException({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS', message: '需要先创建并激活一个法币提现地址才能登记提现地址' }),
        { attempted: 'registerAddress', customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API', metadata: { network: network.code } },
      );
    }

    const traceId = crypto.randomUUID();

    // 归因（站在 Sumsub 一侧的 mock）= 系统结论；自报托管 ≠ 归因 → 红旗留痕不拦截
    const attribution = await this.trAdapter.attributeAddress(dto.address, network.code);
    const addressType = attribution.attributed ? 'VASP' : 'SELF_CUSTODY';
    const hostingMismatch = dto.declaredHosting !== addressType;
    // 登记时筛查：mock 按尾号给确定性结论；RED 在主体层落点计算里直接落 REJECTED
    const screeningAnswer = await this.trAdapter.screenAddress(dto.address, network.code);

    const address = await this.addressService.create({
      customerId,
      customerNo,
      network: network.code,
      address: dto.address,
      addressType,
      label: dto.label,
      beneficiaryName: dto.beneficiaryName,
      memo: dto.memo,
      counterpartyVaspName: attribution.vaspName,
      counterpartyVaspDid: attribution.vaspDid,
      ownerType: dto.ownerType,
      beneficiaryRelationship: dto.beneficiaryRelationship,
      declaredHosting: dto.declaredHosting,
      hostingMismatch,
      screeningAnswer,
      traceId,
    }).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'registerAddress', customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API', metadata: { network: network.code, address: dto.address } }),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_REGISTERED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: address.addressNo,
        correlationId: traceId,
        outcome: AuditOutcome.SUCCESS,
        afterData: {
          addressType,
          address: dto.address,
          network: network.code,
          counterpartyVaspName: attribution.vaspName,
          label: dto.label,
          ownerType: dto.ownerType,
          declaredHosting: dto.declaredHosting,
          screeningAnswer,
          hostingMismatch,
        },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_REGISTERED_${address.addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );

    // 随 REGISTERED 的三条附带留痕，时间线顺序：第三方申报 → 托管红旗 → 登记即拒
    if (dto.ownerType === 'THIRD_PARTY') {
      await this.recordThirdPartyDeclared(address.addressNo, traceId, customerNo, dto);
    }
    if (hostingMismatch) {
      await this.auditLogsService.recordSystem({
        action: 'WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: address.addressNo,
        correlationId: traceId,
        outcome: AuditOutcome.SUCCESS,
        afterData: { declaredHosting: dto.declaredHosting, attributedType: addressType, counterpartyVaspName: attribution.vaspName },
        sourcePlatform: 'SYSTEM',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED_${address.addressNo}_${crypto.randomUUID()}`,
      } as any);
    }
    if (address.status === 'REJECTED') {
      await this.recordRejectedAtRegistration(address, traceId, customerNo);
    }

    this.logger.log(`Withdrawal address ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  /** 第三方申报快照：客户亲自申报（客户主体），随 REGISTERED 加记，crypto / 银行共用 */
  private async recordThirdPartyDeclared(
    addressNo: string,
    traceId: string,
    customerNo: string,
    dto: { beneficiaryName?: string; beneficiaryRelationship?: string },
  ) {
    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: traceId,
        outcome: AuditOutcome.SUCCESS,
        afterData: { beneficiaryName: dto.beneficiaryName, beneficiaryRelationship: dto.beneficiaryRelationship, addressNo },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );
  }

  /**
   * 登记即拒（筛查 RED，尾号 3333）：插入即终态属落点计算、不是边，所以没有 fromStatus；
   * 系统主体记账（不是 operator 也不是客户动的手）。crypto / 银行共用。
   */
  private async recordRejectedAtRegistration(address: { addressNo: string; status: string }, traceId: string, customerNo: string) {
    await this.auditLogsService.recordSystem({
      action: 'WITHDRAWAL_ADDRESS_REJECTED',
      actionDomain: 'CONFIG',
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: address.addressNo,
      correlationId: traceId,
      outcome: AuditOutcome.SUCCESS,
      reason: 'Screening returned RED at registration',
      toStatus: address.status,
      sourcePlatform: 'SYSTEM',
      ownerCustomerNo: customerNo,
      requestId: `WITHDRAWAL_ADDRESS_REJECTED_${address.addressNo}_${crypto.randomUUID()}`,
    } as any);
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

    const traceId = crypto.randomUUID();

    const cleanIban = dto.iban.replace(/\s/g, '').toUpperCase();
    // 银行路径无归因、无托管自报（没有 hostingMismatch 红旗）；筛查按清洗后的 IBAN 尾号
    const screeningAnswer = await this.trAdapter.screenAddress(cleanIban, BANK_RAIL_NETWORK);

    const address = await this.addressService.createBankAccount({
      customerId,
      customerNo,
      iban: dto.iban,
      swiftBic: dto.swiftBic,
      bankName: dto.bankName,
      beneficiaryName: dto.beneficiaryName,
      label: dto.label,
      ownerType: dto.ownerType,
      beneficiaryRelationship: dto.beneficiaryRelationship,
      screeningAnswer,
      traceId,
    }).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'registerBankAccount', customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API' }),
    );

    const maskedIban = cleanIban.length > 8
      ? `${cleanIban.slice(0, 4)}****${cleanIban.slice(-4)}`
      : cleanIban;

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_REGISTERED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: address.addressNo,
        correlationId: traceId,
        outcome: AuditOutcome.SUCCESS,
        afterData: {
          addressType: 'BANK',
          iban: maskedIban,
          bankName: dto.bankName,
          network: BANK_RAIL_NETWORK,
          skipCooling: address.status === 'ACTIVE',
          ownerType: dto.ownerType,
          screeningAnswer,
        },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_REGISTERED_${address.addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );

    if (dto.ownerType === 'THIRD_PARTY') {
      await this.recordThirdPartyDeclared(address.addressNo, traceId, customerNo, dto);
    }
    if (address.status === 'REJECTED') {
      await this.recordRejectedAtRegistration(address, traceId, customerNo);
    }

    this.logger.log(`Bank account ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  async cancelAddress(addressNo: string, customerId: string, customerNo: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.cancel(addressNo, customerId).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'cancelAddress', addressNo, customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API' }),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_CANCELLED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { cancelledByCustomerNo: customerNo },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_CANCELLED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );

    return result;
  }

  async deactivateAddress(addressNo: string, customerId: string, customerNo: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.deactivate(addressNo, customerId).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'deactivateAddress', addressNo, customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API' }),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_DEACTIVATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { deactivatedByCustomerNo: customerNo },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_DEACTIVATED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );

    return result;
  }

  /**
   * 主体层 activate()（withdrawal-address.service.ts）到期前调用会抛 COOLING_PERIOD_NOT_EXPIRED——
   * 这是目前唯一会撞上这个五门码的调用路径，但这里没套 recordDeniedAndRethrow：今天的两条调用方
   * （cron 扫描 WithdrawalAddressSweepService、懒激活 batchActivateExpired）都已按 activatesAt
   * 到期时间预过滤，不会有人在这里被拒。未来若加手动激活入口，必须仿照 suspendAddress /
   * skipCoolingPeriod 那样用 recordDeniedAndRethrow 包一层，把 DENIED 补上留痕。
   */
  async activateAddress(addressNo: string, activatedBy: 'CRON' | 'LAZY' = 'CRON') {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.activate(addressNo);

    if (result.status === 'ACTIVE' && existing.status === 'PENDING_ACTIVATION') {
      await this.auditLogsService.recordSystem({
        action: 'WITHDRAWAL_ADDRESS_ACTIVATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { activatedBy },
        sourcePlatform: 'SYSTEM',
        ownerCustomerNo: existing.customerNo,
        requestId: `WITHDRAWAL_ADDRESS_ACTIVATED_${addressNo}_${crypto.randomUUID()}`,
      } as any);
    }

    return result;
  }

  async suspendAddress(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const adminActor: AuditActorContext = { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] };

    const result = await this.addressService.suspend(addressNo, actor.userNo, reason).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'suspendAddress', addressNo, customerNo: existing.customerNo, actor: adminActor, sourcePlatform: 'ADMIN_API' }),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_SUSPENDED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { suspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
        requestId: `WITHDRAWAL_ADDRESS_SUSPENDED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      adminActor,
    );

    return result;
  }

  /**
   * Activate all addresses whose cooling period has expired for a given customer.
   * Called from controller before listing/detail endpoints.
   * Each activation goes through the workflow's activateAddress (with full audit).
   */
  async batchActivateExpired(customerId: string, network?: string): Promise<void> {
    const expired = await this.addressService.findExpiredPendingForCustomer(customerId, network);
    for (const addr of expired) {
      try {
        await this.activateAddress(addr.addressNo, 'LAZY');
      } catch (error) {
        // Individual failures are already audit-logged inside activateAddress
        this.logger.warn(`Batch activation failed for ${addr.addressNo}: ${(error as Error).message}`);
      }
    }
  }

  async skipCoolingPeriod(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const adminActor: AuditActorContext = { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] };

    const result = await this.addressService.skipCooling(addressNo).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'skipCoolingPeriod', addressNo, customerNo: existing.customerNo, actor: adminActor, sourcePlatform: 'ADMIN_API' }),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_COOLING_SKIPPED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { skippedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
        requestId: `WITHDRAWAL_ADDRESS_COOLING_SKIPPED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      adminActor,
    );

    return result;
  }

  async updateAddress(addressNo: string, customerId: string, customerNo: string, patch: { label?: string }) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });
    const result = await this.addressService.updateDetails(addressNo, customerId, patch);
    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_UPDATED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        beforeData: { label: existing.label },
        afterData: { label: result.label },
        metadata: { updatedByCustomerNo: customerNo },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_UPDATED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );
    return result;
  }

  async unsuspendAddress(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });
    const result = await this.addressService.unsuspend(addressNo);
    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_UNSUSPENDED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        fromStatus: existing.status,
        toStatus: result.status,
        metadata: { unsuspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
        requestId: `WITHDRAWAL_ADDRESS_UNSUSPENDED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] },
    );
    return result;
  }

  /**
   * 客户签名验证（mock 即点即过）：主体层守卫后写 ownershipVerifiedAt 并走 RELEASE 边进冷却。
   * 不属五门——403/409 原样冒泡，不写审计。
   */
  async verifyOwnershipSignature(addressNo: string, customerId: string, customerNo: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.verifyOwnershipSignature(addressNo, customerId);

    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: existing.status,
        toStatus: result.status,
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: customerNo,
        requestId: `WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      this.customerActor(customerNo),
    );

    return result;
  }

  /**
   * ⚡筛查喂（覆写后门，对已登记的 pending 条目改判）：reason 必填。
   * GREEN/YELLOW 只覆写筛查结论（不迁移）；RED 走 REJECT 边 → REJECTED（终态，占坑即封禁）。
   * 非 pending 态主体层 409，原样冒泡、不写审计——⚡不是绕迁移表的直写通道。
   */
  async feedScreening(
    addressNo: string,
    actor: { userId: string; userNo: string; role: string },
    answer: ScreeningAnswer,
    reason: string,
  ) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const adminActor: AuditActorContext = { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] };

    if (answer === 'RED') {
      const result = await this.addressService.rejectByScreening(addressNo);
      await this.auditLogsService.recordByActor(
        {
          action: 'WITHDRAWAL_ADDRESS_REJECTED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
          primarySubjectNo: addressNo,
          correlationId: existing.traceId,
          outcome: AuditOutcome.SUCCESS,
          reason,
          fromStatus: existing.status,
          toStatus: result.status,
          metadata: { screeningFedBy: actor.userNo },
          sourcePlatform: 'ADMIN_API',
          ownerCustomerNo: existing.customerNo,
          requestId: `WITHDRAWAL_ADDRESS_REJECTED_${addressNo}_${crypto.randomUUID()}`,
        } as any,
        adminActor,
      );
      return result;
    }

    const result = await this.addressService.recordScreening(addressNo, answer);
    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_SCREENED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        afterData: { answer },
        metadata: { screeningFedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
        requestId: `WITHDRAWAL_ADDRESS_SCREENED_${addressNo}_${crypto.randomUUID()}`,
      } as any,
      adminActor,
    );
    return result;
  }
}
