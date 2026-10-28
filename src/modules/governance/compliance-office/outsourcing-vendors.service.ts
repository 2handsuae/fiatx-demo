// 战役甲波四 · 合规办公室骨架（Task 4）：外包供应商登记册 OutsourcingVendor。
// 铁律③：本服务只写自己的一张表（outsourcing_vendors）。
// 甲波六 T6：登记册改成服务商准入——运营 apply（系统按四问判重大性）→ 合规官评估（尽调评估主体）→ 按重大性分流审批 →
// 一般 ACTIVE / 重大待报备；七态十边，每条边一个审计码（VENDOR_ACTION_BY_EDGE）。合规官不再直接登记 / 改行：
// 旧 register / update 整体退役，离开 PENDING_* 的唯一路径是 transition 沿显式迁移表走。
// 照 LpProfileService 的形状：档案审计全收在本服务，workflow（OutsourcingVendorWorkflowService）零审计写入、零直写表。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { OutsourcingVendor, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { VENDOR_ACTION_BY_EDGE, VENDOR_TRANSITIONS, VendorCriticality, VendorStatus, VendorStatusValue, judgeCriticality } from './compliance-office.constants';
import { ApplyVendorBodyDto } from './dto/compliance-office.dto';

/** transition() 的第四参——审计上下文（workflow 在裁决 / 下结论时传入；没有 actor 即系统写）。 */
export interface VendorTransitionAudit {
  approvalNo?: string;
  causationId?: string;
  actor?: ApprovalActorContext;
  reason?: string;
  /** 这一步改了什么（resubmit 带整张申请表的新值，让审计时间线看得见运营改了啥）。 */
  afterData?: Record<string, unknown>;
}

/** 对外投影（铁律⑥）：无 id；用户是 userNo；实际控制人解析成数组、交付地拆成数组、年费用是普通小数串。 */
export interface VendorView {
  vendorNo: string;
  name: string;
  registeredIn: string;
  registrationNo: string;
  deliveryLocations: string[];
  contactName: string;
  contactEmail: string;
  beneficialOwners: Array<{ seq: number; name: string; nationality?: string }>;
  licensingAuthority: string | null;
  licenceNo: string | null;
  serviceDescription: string;
  regulatedFunction: boolean;
  involvesPersonalData: boolean;
  involvesConfidentialInfo: boolean;
  contractStart: string;
  contractEnd: string | null;
  annualFee: string | null;
  feeCurrency: string | null;
  subcontracts: boolean;
  subcontractorNames: string | null;
  applicationReason: string;
  impactLicence: boolean;
  impactLegal: boolean;
  impactFinancial: boolean;
  impactContinuity: boolean;
  replaceability: string;
  criticality: string;
  criticalityReason: string | null;
  status: string;
  approvalNo: string | null;
  notificationFilingNo: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

@Injectable()
export class OutsourcingVendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(vendorNo: string): Promise<OutsourcingVendor> {
    const row = await this.prisma.outsourcingVendor.findUnique({ where: { vendorNo } });
    if (!row) throw new NotFoundException(`Outsourcing vendor not found: ${vendorNo}`);
    return row;
  }

  /** 告知单号反查：重大服务商批后自动开出的「重大变更告知」报送单，报送台标记已报送时据此认领（T7 消费）。 */
  async findByNotificationFilingNo(notificationFilingNo: string): Promise<OutsourcingVendor | null> {
    return this.prisma.outsourcingVendor.findFirst({ where: { notificationFilingNo } });
  }

  /** 列表/详情投影——铁律⑥零 id。 */
  async list(): Promise<VendorView[]> {
    const rows = await this.prisma.outsourcingVendor.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r: OutsourcingVendor) => this.toView(r));
  }

  async getView(vendorNo: string): Promise<VendorView> {
    return this.toView(await this.findByNo(vendorNo));
  }

  /** 付款单开单守卫（战役乙波二 T4 消费，照 LpProfileService.assertActiveByNo 形态）：
   *  非 ACTIVE 一律拒——待报备 / 已终止的服务商不能收公司付款。 */
  async assertActiveByNo(vendorNo: string): Promise<void> {
    const row = await this.findByNo(vendorNo);
    if (row.status !== VendorStatus.ACTIVE) {
      throw new BadRequestException(`Outsourcing vendor ${vendorNo} is not ACTIVE (status=${row.status}) — cannot open a vendor payment against it.`);
    }
  }

  private toView(row: OutsourcingVendor): VendorView {
    return {
      vendorNo: row.vendorNo,
      name: row.name,
      registeredIn: row.registeredIn,
      registrationNo: row.registrationNo,
      deliveryLocations: row.deliveryLocations ? row.deliveryLocations.split(',') : [],
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      beneficialOwners: JSON.parse(row.beneficialOwners || '[]'),
      licensingAuthority: row.licensingAuthority ?? null,
      licenceNo: row.licenceNo ?? null,
      serviceDescription: row.serviceDescription,
      regulatedFunction: row.regulatedFunction,
      involvesPersonalData: row.involvesPersonalData,
      involvesConfidentialInfo: row.involvesConfidentialInfo,
      contractStart: row.contractStart.toISOString(),
      contractEnd: row.contractEnd ? row.contractEnd.toISOString() : null,
      annualFee: row.annualFee === null || row.annualFee === undefined ? null : new Prisma.Decimal(row.annualFee).toFixed(),
      feeCurrency: row.feeCurrency ?? null,
      subcontracts: row.subcontracts,
      subcontractorNames: row.subcontractorNames ?? null,
      applicationReason: row.applicationReason,
      impactLicence: row.impactLicence,
      impactLegal: row.impactLegal,
      impactFinancial: row.impactFinancial,
      impactContinuity: row.impactContinuity,
      replaceability: row.replaceability,
      criticality: row.criticality,
      criticalityReason: row.criticalityReason ?? null,
      status: row.status,
      approvalNo: row.approvalNo ?? null,
      notificationFilingNo: row.notificationFilingNo ?? null,
      notes: row.notes ?? null,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 申请表里的实际控制人，剥到「身份」两键 {seq, name}——尽调评估据此判断谁已筛、缺谁。 */
  beneficialOwnersOf(row: OutsourcingVendor): Array<{ seq: number; name: string }> {
    const owners: Array<{ seq: number; name: string }> = JSON.parse(row.beneficialOwners || '[]');
    return owners.map((o) => ({ seq: o.seq, name: o.name }));
  }

  // ── 申请 / 重提 ─────────────────────────────────────────────────────

  /** 申请表 DTO → 行字段（apply 与 resubmit 共用，整行覆盖时同一份映射）。多值字段落库形态：
   *  实际控制人 JSON 串、交付地逗号串；年费用保持字符串交给 Prisma Decimal。 */
  private applicationColumns(dto: ApplyVendorBodyDto) {
    return {
      name: dto.name,
      registeredIn: dto.registeredIn,
      registrationNo: dto.registrationNo,
      deliveryLocations: dto.deliveryLocations.join(','),
      contactName: dto.contactName,
      contactEmail: dto.contactEmail,
      beneficialOwners: JSON.stringify(
        (dto.beneficialOwners ?? []).map((o) => ({ seq: o.seq, name: o.name, ...(o.nationality ? { nationality: o.nationality } : {}) })),
      ),
      licensingAuthority: dto.licensingAuthority ?? null,
      licenceNo: dto.licenceNo ?? null,
      serviceDescription: dto.serviceDescription,
      regulatedFunction: dto.regulatedFunction,
      contractStart: new Date(dto.contractStart),
      contractEnd: dto.contractEnd ? new Date(dto.contractEnd) : null,
      involvesPersonalData: dto.involvesPersonalData,
      involvesConfidentialInfo: dto.involvesConfidentialInfo,
      annualFee: dto.annualFee ?? null,
      feeCurrency: dto.feeCurrency ?? null,
      subcontracts: dto.subcontracts ?? false,
      subcontractorNames: dto.subcontractorNames ?? null,
      applicationReason: dto.applicationReason,
      impactLicence: dto.impactLicence,
      impactLegal: dto.impactLegal,
      impactFinancial: dto.impactFinancial,
      impactContinuity: dto.impactContinuity,
      replaceability: dto.replaceability,
    };
  }

  /** 业务规则（spec §5.1）：「是否受监管职能」答是 → 发牌机构与牌照号必填。 */
  private assertLicenceWhenRegulated(dto: ApplyVendorBodyDto): void {
    if (dto.regulatedFunction && (!dto.licensingAuthority?.trim() || !dto.licenceNo?.trim())) {
      throw new BadRequestException('A regulated function requires both the licensing authority and the licence number.');
    }
  }

  /** 运营提交申请：重大性由系统判（四问任一「会」→ MATERIAL），出生即 PENDING_ASSESSMENT。
   *  留痕只有 VENDOR_APPLIED（操作员）一条——词表必填 criticality 顶层展开，metadata 镜像判定结果与四问。 */
  async apply(actor: ApprovalActorContext, dto: ApplyVendorBodyDto): Promise<{ vendorNo: string; criticality: VendorCriticality }> {
    this.assertLicenceWhenRegulated(dto);
    const criticality = judgeCriticality(dto);
    const row = await this.prisma.outsourcingVendor.create({
      data: {
        vendorNo: generateReferenceNo('VEN'),
        ...this.applicationColumns(dto),
        criticality,
        status: VendorStatus.PENDING_ASSESSMENT,
        createdByUserId: actor.userNo ?? actor.userId,
        traceId: randomUUID(),
      },
    });
    await this.writeAudit(AuditActions.VENDOR_APPLIED, row, {
      actor,
      extra: { criticality },
      metadata: {
        name: row.name, criticality, deliveryLocations: dto.deliveryLocations, regulatedFunction: dto.regulatedFunction,
        impactLicence: dto.impactLicence, impactLegal: dto.impactLegal, impactFinancial: dto.impactFinancial, impactContinuity: dto.impactContinuity,
        replaceability: dto.replaceability,
      },
    });
    return { vendorNo: row.vendorNo, criticality };
  }

  /** 被退回后运营改申请重提：仅 RETURNED 态可调（PENDING_APPROVAL → PENDING_ASSESSMENT 是撤单边，不能借「重提」走），
   *  申请表整行覆盖，再沿 RETURNED → PENDING_ASSESSMENT 迁一步（VENDOR_RESUBMITTED，afterData 带新表单）。
   *  重大性随表单重算，但**不得降档**：原 MATERIAL（自判或合规升档）重提后仍 MATERIAL。 */
  async resubmit(vendorNo: string, actor: ApprovalActorContext, dto: ApplyVendorBodyDto): Promise<OutsourcingVendor> {
    const row = await this.findByNo(vendorNo);
    if (row.status !== VendorStatus.RETURNED) {
      throw new BadRequestException(`Only a RETURNED application can be resubmitted (status=${row.status}).`);
    }
    this.assertLicenceWhenRegulated(dto);
    const criticality: VendorCriticality = row.criticality === 'MATERIAL' ? 'MATERIAL' : judgeCriticality(dto);
    return this.transition(vendorNo, VendorStatus.PENDING_ASSESSMENT, { ...this.applicationColumns(dto), criticality }, {
      actor,
      afterData: this.applicationSnapshot(dto),
    });
  }

  /** 审计 afterData 用的申请表快照（DTO 原样，不含任何内部 id）。 */
  private applicationSnapshot(dto: ApplyVendorBodyDto): Record<string, unknown> {
    return {
      name: dto.name, registeredIn: dto.registeredIn, registrationNo: dto.registrationNo,
      deliveryLocations: dto.deliveryLocations, contactName: dto.contactName, contactEmail: dto.contactEmail,
      beneficialOwners: dto.beneficialOwners ?? [], licensingAuthority: dto.licensingAuthority ?? null, licenceNo: dto.licenceNo ?? null,
      serviceDescription: dto.serviceDescription, regulatedFunction: dto.regulatedFunction,
      contractStart: dto.contractStart, contractEnd: dto.contractEnd ?? null,
      involvesPersonalData: dto.involvesPersonalData, involvesConfidentialInfo: dto.involvesConfidentialInfo,
      annualFee: dto.annualFee ?? null, feeCurrency: dto.feeCurrency ?? null,
      subcontracts: dto.subcontracts ?? false, subcontractorNames: dto.subcontractorNames ?? null,
      applicationReason: dto.applicationReason,
      impactLicence: dto.impactLicence, impactLegal: dto.impactLegal, impactFinancial: dto.impactFinancial, impactContinuity: dto.impactContinuity,
      replaceability: dto.replaceability,
    };
  }

  // ── 升档 ────────────────────────────────────────────────────────────

  /** 合规官把 NON_MATERIAL 升为 MATERIAL（spec §5.2：只升不降，理由必填）。不动状态——可写窗口由 workflow 把关。 */
  async upgradeMateriality(vendorNo: string, actor: ApprovalActorContext, reason: string): Promise<void> {
    const row = await this.findByNo(vendorNo);
    if (row.criticality === 'MATERIAL') {
      throw new BadRequestException('Already MATERIAL — materiality can only be raised, never lowered.');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to upgrade materiality.');
    }
    const updated = await this.prisma.outsourcingVendor.update({
      where: { vendorNo },
      data: { criticality: 'MATERIAL', criticalityReason: reason.trim() },
    });
    await this.writeAudit(AuditActions.VENDOR_MATERIALITY_UPGRADED, updated, {
      actor,
      reason: reason.trim(),
      metadata: { reason: reason.trim(), fromCriticality: row.criticality, toCriticality: 'MATERIAL' },
    });
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = VENDOR_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal vendor status transition: ${from} → ${to}`);
  }

  async transition(vendorNo: string, to: VendorStatusValue, patch: Record<string, unknown> = {}, audit?: VendorTransitionAudit): Promise<OutsourcingVendor> {
    const row = await this.findByNo(vendorNo);
    this.assertTransition(row.status, to);
    const action = VENDOR_ACTION_BY_EDGE[`${row.status}->${to}`];
    if (!action) {
      // 完整性闸：VENDOR_TRANSITIONS 的每条边都必须在 VENDOR_ACTION_BY_EDGE 登记对应审计码，
      // 否则会静默丢审计（assertActionSpec 对未注册的 action 直接 return，不报错）——
      // 铁律①操作必留痕不容许这个洞，故显式炸而不是悄悄放过。闸在 update 之前：先炸后写，
      // 不留「状态已落库却无审计」。
      throw new InternalServerErrorException(`No audit action registered for vendor edge ${row.status} → ${to}.`);
    }
    const updated = await this.prisma.outsourcingVendor.update({ where: { vendorNo }, data: { status: to, ...patch } });
    await this.writeAudit(action, updated, {
      fromStatus: row.status,
      toStatus: to,
      approvalNo: audit?.approvalNo,
      causationId: audit?.causationId,
      reason: audit?.reason,
      afterData: audit?.afterData,
      actor: audit?.actor,
    });
    return updated;
  }

  /** 终止（合规官，ACTIVE → TERMINATED 唯一边，终态零出边，无硬删）。出发态钉死 ACTIVE：审批中 / 待报备的服务商
   *  还没进册，不能被「终止」绕开审批门或报备门（表里今天通向 TERMINATED 的边只有 ACTIVE 一条，这道钉防的是以后加边）。 */
  async terminate(vendorNo: string, actor: ApprovalActorContext, dto: { notes?: string } = {}): Promise<{ vendorNo: string }> {
    const row = await this.findByNo(vendorNo);
    if (row.status !== VendorStatus.ACTIVE) {
      throw new BadRequestException(`Illegal vendor status transition: ${row.status} → ${VendorStatus.TERMINATED} — only an ACTIVE vendor can be terminated.`);
    }
    await this.transition(vendorNo, VendorStatus.TERMINATED, dto.notes !== undefined ? { notes: dto.notes } : {}, { actor });
    return { vendorNo };
  }

  // ── 盖章（铁律③同款：回填走主体服务，workflow 不直写自己域外的表）────────────

  async stampApprovalNo(vendorNo: string, approvalNo: string): Promise<void> {
    await this.prisma.outsourcingVendor.update({ where: { vendorNo }, data: { approvalNo } });
  }

  /** 重大服务商批后，workflow 开出「重大变更告知」报送单，把单号回填到服务商自己的行上（报送单表没有 entityRef，
   *  由服务商记 notificationFilingNo——各管各的）。系统写 VENDOR_NOTIFICATION_OPENED（顶层 filingNo）。 */
  async stampNotificationFilingNo(vendorNo: string, filingNo: string): Promise<void> {
    const updated = await this.prisma.outsourcingVendor.update({ where: { vendorNo }, data: { notificationFilingNo: filingNo } });
    await this.writeAudit(AuditActions.VENDOR_NOTIFICATION_OPENED, updated, {
      extra: { filingNo },
      metadata: { filingNo },
    });
  }

  // ── 审计（信封构造可复用；照 LpProfileService.writeAudit——patch.actor 有则 recordByActor、无则 recordSystem。
  //     primarySubject 恒为 OUTSOURCING_VENDOR/vendorNo；审批单为 INSTRUMENT 子主体；correlationId 恒继承
  //     row.traceId（VENDOR_APPLIED 铸的旅程）；每条带显式 requestId，否则同 (action, subject, correlation)
  //     的第二次调用会撞同一把 idempotencyKey 被静默去重）──────────────────────────

  private async writeAudit(action: string, row: OutsourcingVendor, patch: {
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string;
    reason?: string; metadata?: Record<string, unknown>; afterData?: Record<string, unknown>; actor?: ApprovalActorContext;
    /** 词表 requiredFields 要求在信封顶层的业务键（assertActionSpec 只查顶层），如 VENDOR_APPLIED 的 criticality。 */
    extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.OUTSOURCING_VENDOR, subjectNo: row.vendorNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.OUTSOURCING_VENDOR,
      primarySubjectType: AuditEntityTypes.OUTSOURCING_VENDOR, primarySubjectNo: row.vendorNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId, reason: patch.reason,
      afterData: patch.afterData,
      correlationId: row.traceId,
      requestId: `${action}_${row.vendorNo}_${randomUUID()}`,
      metadata: { vendorNo: row.vendorNo, name: row.name, ...(patch.metadata ?? {}) },
      sourcePlatform: patch.actor ? 'ADMIN' : 'SYSTEM',
      ...(patch.extra ?? {}),
    };
    if (patch.actor) {
      const display = patch.actor.userNo ?? patch.actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: patch.actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}
