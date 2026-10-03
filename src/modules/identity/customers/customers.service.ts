import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditSubjectRole, CreateAuditLogEventDto } from '../../audit-logging/dto/audit-log.dto';
import { maskAuditPayload } from '../../audit-logging/utils/audit-mask.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

/** 运营改档案通道的白名单 = CDD 七字段（与 updateOnboardingData 的 CDD 段对齐）。
 *  email/phone（登录标识）、riskRating/lifecycle/tradingTier/限制/标签等一律不在此通道改。 */
export const PROFILE_EDITABLE_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'nationality', 'idDocType', 'idDocNumber', 'residentialAddress',
] as const;
export type ProfileEditableField = (typeof PROFILE_EDITABLE_FIELDS)[number];

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.CustomerMainWhereUniqueInput;
    where?: Prisma.CustomerMainWhereInput;
    orderBy?: Prisma.CustomerMainOrderByWithRelationInput;
  }): Promise<{ data: CustomerMain[]; total: number }> {
    const { skip, take, cursor, where, orderBy } = params;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customerMain.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      }),
      this.prisma.customerMain.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<CustomerMain | null> {
    return this.prisma.customerMain.findUnique({
      where: { id },
    });
  }

  /** 铁律⑥ 对外用业务键：controller 用它把路由上的 customerNo 换回内部 id。 */
  async findByCustomerNo(customerNo: string): Promise<CustomerMain | null> {
    return this.prisma.customerMain.findUnique({
      where: { customerNo },
    });
  }

  /** 入驻实体字段的唯一显式写方法（波二）。运营改档案走 updateProfileFields。workflow 不直写表（铁律③）。 */
  async updateOnboardingData(
    customerId: string,
    data: Partial<{
      firstName: string; lastName: string;
      dateOfBirth: string; nationality: string; idDocType: string;
      idDocNumber: string; residentialAddress: string;
      onboardingSubmittedAt: Date | null;
      onboardingFinalRejectedAt: Date | null;
      eddRequired: boolean;
      sumsubApplicantId: string;
      sumsubCurrentLevelName: string;
    }>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = (tx ?? this.prisma) as PrismaService;
    return db.customerMain.update({ where: { id: customerId }, data });
  }

  /**
   * 运营改档案（战役丙波四 T8；CUSTOMER_WRITE 孤儿桶 customer.manage_profile 的第一条真路由）。
   * 白名单外的键整单 400（不是静默剥掉）；只写与现值真不同的字段；写库后落一条
   * CUSTOMER_PROFILE_UPDATED，逐字段 before/after 差异经 audit-mask 打码后进 metadata.before/after。
   * 什么都没变 = 没有持久动作，也就没有留痕，直接返回。
   */
  async updateProfileFields(
    actor: ApprovalActorContext,
    customerNo: string,
    patch: Partial<Record<ProfileEditableField, string>>,
  ): Promise<void> {
    const illegal = Object.keys(patch).filter((k) => !(PROFILE_EDITABLE_FIELDS as readonly string[]).includes(k));
    if (illegal.length > 0) {
      throw new BadRequestException({
        code: 'PROFILE_FIELD_NOT_EDITABLE',
        message: `These fields cannot be edited here: ${illegal.join(', ')}. Editable: ${PROFILE_EDITABLE_FIELDS.join(', ')}`,
      });
    }
    const customer = await this.prisma.customerMain.findUnique({ where: { customerNo } });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerNo}`);

    const changedFields = PROFILE_EDITABLE_FIELDS.filter(
      (f) => patch[f] !== undefined && patch[f] !== (customer[f] ?? null),
    );
    if (changedFields.length === 0) return;

    const data = Object.fromEntries(changedFields.map((f) => [f, patch[f]]));
    await this.prisma.customerMain.update({ where: { id: customer.id }, data });

    const display = actor.userNo ?? actor.userId;
    // requiredFields（customerNo/changedFields）顶层展开——assertActionSpec 只查 input 顶层；metadata 同步镜像。
    const input: CreateAuditLogEventDto & { customerNo: string; changedFields: string[] } = {
      action: AuditActions.CUSTOMER_PROFILE_UPDATED,
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: customerNo,
      ownerCustomerNo: customerNo,
      subjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: AuditSubjectRole.PRIMARY }],
      customerNo,
      changedFields,
      // 差异进 metadata：before/after 各是「字段名→值」的平对象，audit-mask 按字段名键打码（证件号/住址）。
      metadata: {
        customerNo,
        changedFields,
        before: maskAuditPayload(Object.fromEntries(changedFields.map((f) => [f, customer[f] ?? null]))),
        after: maskAuditPayload(data),
      },
      reason: `Customer profile updated by operator: ${changedFields.join(', ')}`,
      // 同一客户可反复改：requestId 带随机后缀，否则第二次会被审计 idempotencyKey 静默吞掉。
      requestId: `${AuditActions.CUSTOMER_PROFILE_UPDATED}_${customerNo}_${randomUUID()}`,
      sourcePlatform: 'ADMIN_API',
    };
    await this.auditLogs.recordByActor(input, {
      actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [],
    });
  }

  /**
   * 客户自助改 phone（战役丙波四 T9；DSR「改」的联系方式出口，DSR RECTIFICATION_SELF_SERVICE 指路到这里）。
   * 只开 phone 一个字段：email 是登录凭据不碰，其余全是 KYC/CDD 字段（走材料重核验 / 运营改档案）。
   * phone 同时是登录标识之一（customer-auth OR 匹配）——改后用新号登录属正常语义，不设确认流。
   * 业务规则（非防御校验）：phone 不许清空（登录标识）→ 400 PHONE_REQUIRED；schema `phone @unique`，
   * 撞了别的客户的号 → 捕获 P2002 显式 409 PHONE_ALREADY_IN_USE。
   * 与现值相同 = 没有持久动作，也就没有留痕，直接返回。
   * 写库后落一条 CUSTOMER_PHONE_UPDATED，actor=客户本人；新旧号经 audit-mask（小写 'phone' 键）打码后进 metadata.before/after。
   */
  async updatePhoneSelf(customerId: string, phone: string): Promise<void> {
    const next = typeof phone === 'string' ? phone.trim() : '';
    if (!next) {
      throw new BadRequestException({ code: 'PHONE_REQUIRED', message: 'Phone number cannot be empty — it is also a login identifier' });
    }
    const customer = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (customer.phone === next) return;

    try {
      await this.prisma.customerMain.update({ where: { id: customerId }, data: { phone: next } });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException({ code: 'PHONE_ALREADY_IN_USE', message: 'This phone number is already registered to another account' });
      }
      throw err;
    }

    const customerNo = customer.customerNo;
    // customerNo 顶层展开——assertActionSpec 只查 input 顶层；metadata 同步镜像。
    const input: CreateAuditLogEventDto & { customerNo: string } = {
      action: AuditActions.CUSTOMER_PHONE_UPDATED,
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: customerNo,
      ownerCustomerNo: customerNo,
      subjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: AuditSubjectRole.PRIMARY }],
      customerNo,
      metadata: {
        customerNo,
        before: maskAuditPayload({ phone: customer.phone ?? null }),
        after: maskAuditPayload({ phone: next }),
      },
      reason: 'Customer changed own phone number',
      // 同一客户可反复改：requestId 带随机后缀，否则第二次会被审计 idempotencyKey 静默吞掉。
      requestId: `${AuditActions.CUSTOMER_PHONE_UPDATED}_${customerNo}_${randomUUID()}`,
      sourcePlatform: 'CLIENT_API',
    };
    await this.auditLogs.recordByActor(input, {
      actorType: 'CUSTOMER', actorNo: customerNo, actorDisplayName: customerNo, actorRolesAtTime: ['CUSTOMER'],
    });
  }

  /**
   * 2026-08-17 材料请求账（Task 12）：从已删除的客户级补料 service 搬来。
   * 这个客户是否曾被任意一笔兑换硬线处置过。一旦为真，后续软线裁决不再
   * 暴露补料入口。
   */
  async hasHardLineDisposition(customerId: string): Promise<boolean> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    return !!c?.hardLineDispositionedAt;
  }

  /** 档位唯一运行时写口（波三 spec §6）：只许 BASIC→PREMIUM，一切经升级申请单裁决处理器。 */
  async applyTierUpgrade(customerId: string, tx?: Prisma.TransactionClient): Promise<{ fromTier: 'BASIC'; toTier: 'PREMIUM' }> {
    const db = tx ?? this.prisma;
    const c = await db.customerMain.findUnique({ where: { id: customerId }, select: { tradingTier: true } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (c.tradingTier !== 'BASIC') throw new BadRequestException(`Tier transition not allowed: ${c.tradingTier} -> PREMIUM`);
    await db.customerMain.update({ where: { id: customerId }, data: { tradingTier: 'PREMIUM' } });
    return { fromTier: 'BASIC', toTier: 'PREMIUM' };
  }

  /** 盖 sticky 硬线章。只在命中制裁时盖 —— 「无 action 的硬线」不该造成永久沉默。 */
  async markHardLineDisposition(customerId: string): Promise<void> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    if (c?.hardLineDispositionedAt) return;
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { hardLineDispositionedAt: new Date() },
    });
  }
}
