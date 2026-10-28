// 战役乙波一 T2 · LP 档案主体（LiquidityProvider）：建行 / 迁移表 / 读投影。
// （LP 两步准入 Task 9：结算坐标列与改坐标流程退役，收款坐标改由打款地址簿 LpPayoutAddress 承载。）
// 甲波六 T4：档案即 LP 申请表——建档只落 PENDING_ASSESSMENT（实体背调 mock 退役，筛查归尽调评估主体），
// 六态九边，被退回后金库 resubmit 整行覆盖。
// 照甲波四 ResponsibleIndividualsService 先例：档案审计动作全收在本服务，workflow（Task 3）零审计写入。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { LiquidityProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { LP_PROFILE_TRANSITIONS } from './constants/lp-profile-transitions.constant';
import { CreateLpProfileDto, LpProfileStatus, LpProfileView } from './dto/lp-profile.dto';

/** transition() 的第四参——审计上下文（接口裁定，供 workflow 在裁决 / 下结论时传入）。 */
export interface LpProfileTransitionAudit {
  approvalNo?: string;
  causationId?: string;
  actor?: ApprovalActorContext;
  reason?: string;
  /** 这一步改了什么（resubmit 带整张申请表的新值，让审计时间线看得见金库改了啥）。 */
  afterData?: Record<string, unknown>;
}

/** (from→to) 边到审计动作码的映射——与 LP_PROFILE_TRANSITIONS 的九条边一一对应。 */
const ACTION_BY_EDGE: Record<string, string> = {
  [`${LpProfileStatus.PENDING_ASSESSMENT}->${LpProfileStatus.RETURNED}`]: AuditActions.LP_PROFILE_RETURNED,
  [`${LpProfileStatus.RETURNED}->${LpProfileStatus.PENDING_ASSESSMENT}`]: AuditActions.LP_PROFILE_RESUBMITTED,
  [`${LpProfileStatus.PENDING_ASSESSMENT}->${LpProfileStatus.REJECTED}`]: AuditActions.LP_PROFILE_REJECTED,
  [`${LpProfileStatus.PENDING_ASSESSMENT}->${LpProfileStatus.PENDING_APPROVAL}`]: AuditActions.LP_PROFILE_SENT_FOR_APPROVAL,
  [`${LpProfileStatus.PENDING_APPROVAL}->${LpProfileStatus.ACTIVE}`]: AuditActions.LP_PROFILE_APPROVED,
  [`${LpProfileStatus.PENDING_APPROVAL}->${LpProfileStatus.REJECTED}`]: AuditActions.LP_PROFILE_REJECTED,
  [`${LpProfileStatus.PENDING_APPROVAL}->${LpProfileStatus.PENDING_ASSESSMENT}`]: AuditActions.LP_PROFILE_APPROVAL_CANCELLED,
  [`${LpProfileStatus.ACTIVE}->${LpProfileStatus.SUSPENDED}`]: AuditActions.LP_PROFILE_SUSPENDED,
  [`${LpProfileStatus.SUSPENDED}->${LpProfileStatus.ACTIVE}`]: AuditActions.LP_PROFILE_REACTIVATED,
};

@Injectable()
export class LpProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(lpNo: string): Promise<LiquidityProvider> {
    const row = await this.prisma.liquidityProvider.findUnique({ where: { lpNo } });
    if (!row) throw new NotFoundException(`Liquidity provider not found: ${lpNo}`);
    return row;
  }

  async list(): Promise<LpProfileView[]> {
    const rows = await this.prisma.liquidityProvider.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r: LiquidityProvider) => this.toView(r));
  }

  /** 兑换单开单守卫（Task 5 消费）：非 ACTIVE 一律拒。 */
  async assertActiveByNo(lpNo: string): Promise<void> {
    const row = await this.findByNo(lpNo);
    if (row.status !== LpProfileStatus.ACTIVE) {
      throw new BadRequestException(`Liquidity provider ${lpNo} is not ACTIVE (status=${row.status}) — cannot open an LP exchange order against it.`);
    }
  }

  /** 对外投影（铁律⑥）：无 id。 */
  toView(row: LiquidityProvider): LpProfileView {
    return {
      lpNo: row.lpNo,
      name: row.name,
      registeredIn: row.registeredIn,
      registrationNo: row.registrationNo,
      licensingAuthority: row.licensingAuthority,
      licenceNo: row.licenceNo,
      beneficialOwners: JSON.parse(row.beneficialOwners || '[]'),
      tradingTypes: row.tradingTypes ? row.tradingTypes.split(',') : [],
      expectedMonthlyVolume: new Prisma.Decimal(row.expectedMonthlyVolume).toFixed(),
      volumeCurrency: row.volumeCurrency,
      applicationReason: row.applicationReason,
      agreementRef: row.agreementRef,
      agreementStart: row.agreementStart ? row.agreementStart.toISOString() : null,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      status: row.status,
      approvalNo: row.approvalNo ?? null,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 申请表里的实际控制人，剥到「身份」两键 {seq, name}——尽调评估据此判断谁已筛、缺谁。 */
  beneficialOwnersOf(row: LiquidityProvider): Array<{ seq: number; name: string }> {
    const owners: Array<{ seq: number; name: string }> = JSON.parse(row.beneficialOwners || '[]');
    return owners.map((o) => ({ seq: o.seq, name: o.name }));
  }

  // ── 建档 / 重提 ─────────────────────────────────────────────────────

  /** 申请表 DTO → 行字段（create 与 resubmit 共用，整行覆盖时同一份映射）。多值字段落库形态：
   *  实际控制人 JSON 串、交易类型逗号串；预计月交易量保持字符串交给 Prisma Decimal。 */
  private applicationColumns(dto: CreateLpProfileDto) {
    return {
      name: dto.name,
      registeredIn: dto.registeredIn,
      registrationNo: dto.registrationNo,
      licensingAuthority: dto.licensingAuthority,
      licenceNo: dto.licenceNo,
      beneficialOwners: JSON.stringify(
        (dto.beneficialOwners ?? []).map((o) => ({ seq: o.seq, name: o.name, ...(o.nationality ? { nationality: o.nationality } : {}) })),
      ),
      tradingTypes: dto.tradingTypes.join(','),
      expectedMonthlyVolume: dto.expectedMonthlyVolume,
      volumeCurrency: dto.volumeCurrency,
      applicationReason: dto.applicationReason,
      agreementRef: dto.agreementRef,
      agreementStart: dto.agreementStart ? new Date(dto.agreementStart) : null,
      contactName: dto.contactName,
      contactEmail: dto.contactEmail,
    };
  }

  /** 建档：金库提交申请表，出生即 PENDING_ASSESSMENT（待合规官评估）。留痕只有 CREATED（操作员）一条——
   *  词表必填 reason（= 申请理由）与 registeredIn 顶层展开，metadata 镜像注册地 / 发牌机构 / 交易类型。 */
  async create(actor: ApprovalActorContext, dto: CreateLpProfileDto): Promise<LiquidityProvider> {
    const row = await this.prisma.liquidityProvider.create({
      data: {
        lpNo: generateReferenceNo('LPP'),
        ...this.applicationColumns(dto),
        status: LpProfileStatus.PENDING_ASSESSMENT,
        createdByUserId: actor.userNo ?? actor.userId,
      },
    });
    await this.writeAudit(AuditActions.LP_PROFILE_CREATED, row, {
      reason: dto.applicationReason,
      actor,
      extra: { registeredIn: dto.registeredIn },
      metadata: { registeredIn: dto.registeredIn, licensingAuthority: dto.licensingAuthority, tradingTypes: dto.tradingTypes },
    });
    return row;
  }

  /** 被退回后金库改申请重提：仅 RETURNED 态可调（PENDING_APPROVAL → PENDING_ASSESSMENT 是撤单边，不能借「重提」走），
   *  申请表整行覆盖，再沿 RETURNED → PENDING_ASSESSMENT 迁一步（LP_PROFILE_RESUBMITTED，afterData 带新表单）。 */
  async resubmit(lpNo: string, actor: ApprovalActorContext, dto: CreateLpProfileDto): Promise<LiquidityProvider> {
    const row = await this.findByNo(lpNo);
    if (row.status !== LpProfileStatus.RETURNED) {
      throw new BadRequestException(`Only a RETURNED application can be resubmitted (status=${row.status}).`);
    }
    return this.transition(lpNo, LpProfileStatus.PENDING_ASSESSMENT, this.applicationColumns(dto), {
      actor,
      afterData: this.applicationSnapshot(dto),
    });
  }

  /** 审计 afterData 用的申请表快照（DTO 原样，不含任何内部 id）。 */
  private applicationSnapshot(dto: CreateLpProfileDto): Record<string, unknown> {
    return {
      name: dto.name, registeredIn: dto.registeredIn, registrationNo: dto.registrationNo,
      licensingAuthority: dto.licensingAuthority, licenceNo: dto.licenceNo,
      beneficialOwners: dto.beneficialOwners ?? [], tradingTypes: dto.tradingTypes,
      expectedMonthlyVolume: dto.expectedMonthlyVolume, volumeCurrency: dto.volumeCurrency,
      applicationReason: dto.applicationReason, agreementRef: dto.agreementRef,
      agreementStart: dto.agreementStart ?? null, contactName: dto.contactName, contactEmail: dto.contactEmail,
    };
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = LP_PROFILE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal LP profile status transition: ${from} → ${to}`);
  }

  async transition(lpNo: string, to: LpProfileStatus, patch: Record<string, unknown> = {}, audit?: LpProfileTransitionAudit): Promise<LiquidityProvider> {
    const row = await this.findByNo(lpNo);
    this.assertTransition(row.status, to);
    const action = ACTION_BY_EDGE[`${row.status}->${to}`];
    if (!action) {
      // 完整性闸：LP_PROFILE_TRANSITIONS 的每条边都必须在 ACTION_BY_EDGE 登记对应审计码，
      // 否则会静默丢审计（assertActionSpec 对未注册的 action 直接 return，不报错）——
      // 铁律①操作必留痕不容许这个洞，故显式炸而不是悄悄放过。评审随轮小项：闸挪到
      // update 之前——挪之前闸炸时状态已落库却无审计，恰是本闸自己声称要防的洞。
      throw new InternalServerErrorException(`No audit action registered for LP profile edge ${row.status} → ${to}.`);
    }
    const updated = await this.prisma.liquidityProvider.update({ where: { lpNo }, data: { status: to, ...patch } });
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

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(lpNo: string, approvalNo: string): Promise<void> {
    await this.prisma.liquidityProvider.update({ where: { lpNo }, data: { approvalNo } });
  }

  // ── 审计（信封构造可复用；照划转单 transferAudit 的样子——action/subjects/metadata
  //     参数化，patch.actor 有则 recordByActor、无则 recordSystem。primarySubject 恒为
  //     LIQUIDITY_PROVIDER/lpNo；审批单为 INSTRUMENT 子主体；每条带显式 requestId）──────────

  private async writeAudit(action: string, row: LiquidityProvider, patch: {
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string;
    reason?: string; metadata?: Record<string, unknown>; afterData?: Record<string, unknown>; actor?: ApprovalActorContext;
    /** 词表 requiredFields 要求在信封顶层的业务键（assertActionSpec 只查顶层），如 LP_PROFILE_CREATED 的 registeredIn。 */
    extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, subjectNo: row.lpNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    const input: any = {
      action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.LP_PROFILE,
      primarySubjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, primarySubjectNo: row.lpNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId, reason: patch.reason,
      afterData: patch.afterData,
      // CREATED 起档案自己的旅程（NONE——LiquidityProvider 没有 traceId 列）；其余继承
      // （INHERIT，读 lpNo：稳定业务键，够当锚，不必另开一列）。
      ...(action === AuditActions.LP_PROFILE_CREATED ? {} : { correlationId: row.lpNo }),
      requestId: `${action}_${row.lpNo}_${randomUUID()}`,
      metadata: { lpNo: row.lpNo, name: row.name, ...(patch.metadata ?? {}) },
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
