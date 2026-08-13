import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

export type TradeAction = 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | 'ALL';
export interface CustomerRestriction {
  capability: string;
  reason: string;
}

/**
 * 客户交易能力限制（capability 级），复活 CustomerMain.restrictions 死码。
 * 供合规流程（如 Sumsub KYT 拒绝）限制客户的 SWAP/WITHDRAW 能力；DEPOSIT/ALL 亦受支持但
 * 目前无写入方主动限制 DEPOSIT（资金已到账不可拒绝）。读侧见
 * onboarding.service.ts → assertTradingEligibility()。
 */
@Injectable()
export class CustomerRestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async list(customerId: string): Promise<CustomerRestriction[]> {
    const customer = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);
    return CustomerRestrictionsService.parse(customer.restrictions);
  }

  async add(
    customerId: string,
    capabilities: TradeAction[],
    reason: string,
    actorId: string,
  ): Promise<void> {
    const customer = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);

    const current = CustomerRestrictionsService.parse(customer.restrictions);
    const next = [...current];
    for (const capability of capabilities) {
      if (!next.some((r) => r.capability === capability)) {
        next.push({ capability, reason });
      }
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { restrictions: JSON.stringify(next) },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.CUSTOMER_RESTRICTION_ADDED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: customerId,
      entityNo: customer.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: customerId,
      entityOwnerNo: customer.customerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: `${capabilities.join(',')} restricted: ${reason}`,
      metadata: { capabilities, reason, actorId },
    });
  }

  async clear(customerId: string, capabilities: TradeAction[], actorId: string): Promise<void> {
    const customer = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);

    const next = CustomerRestrictionsService.parse(customer.restrictions).filter(
      (r) => !capabilities.includes(r.capability as TradeAction),
    );

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { restrictions: JSON.stringify(next) },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: customerId,
      entityNo: customer.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: customerId,
      entityOwnerNo: customer.customerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: `${capabilities.join(',')} cleared`,
      metadata: { capabilities, actorId },
    });
  }

  private static parse(raw: string | null | undefined): CustomerRestriction[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
