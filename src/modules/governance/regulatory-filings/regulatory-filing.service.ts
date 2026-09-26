// 战役甲波二 · 报送台骨架（spec §3/§4/§5，Task 3）：主体 RegulatoryFiling 的核心服务。
// 铁律③：本服务只写自己的两张表（regulatory_filings / regulatory_filing_entries）；
// openManual('INCIDENT_REPORT') 对事故的读是校验用的横向只读（铁律③放行只读），不写。
// 模板：transition/recordAudit 形状照 incident.service.ts；无 actor 的审计（签发裁决驱动）
// 照 incident-close-workflow.service.ts 的 closeAudit 用 recordSystem 先例。
// 战役甲波三 Task 3：迁移守卫改按族读 FILING_TRANSITIONS_BY_FAMILY（族拆分见 T1）；
// 服务层按族独占（cap.filing.general/cap.filing.aml，照 incidents 的 assertOperator/
// cap.incident.* 先例，Ruling-6）——所有「报送台」写动作（openManual/saveDraft/
// markSignoffRequested/markSubmitted/addEntry/close/cancel/closeNoFiling/openForSanction）
// 先过 assertFamily 再做各自的状态机/字段校验；openForIncident 不在此列——它永远只开
// INCIDENT_REPORT（GENERAL 族硬编码，无跨族风险），且是已经过 cap.incident.* 桶断言的
// IncidentService.assess 的直接产物，不是独立的管理台写动作，加一道 cap.filing.general
// 门只会误伤持有事故经办能力码、但未必持有报送台能力码的事故经办人，见 T3 report。
// applySignoffDecision 是审批裁决异步驱动、无 actor 可判，同样不接 assertFamily。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RegulatoryFiling } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { AccessControlService } from '../../identity/access-control/access-control.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  FILING_FAMILY_CAPABILITY_CODE, FILING_TRANSITIONS_BY_FAMILY, FilingEntryDto, FilingEntryKinds, FilingStatus,
  MarkFilingSubmittedDto, OpenFilingDto, RegulatoryAuthorities,
} from './regulatory-filing.constants';
import { FilingTypeConfig, getFilingTypeConfig } from './filing-type-registry';
import { addBusinessDays } from './business-days';
import { INCIDENT_REPORT_BASES } from '../incidents/incident.constants';
import { INCIDENT_TYPE_REGISTRY } from '../incidents/incident-type-registry';

/** 定损/登记侧调用 openForIncident 时传入的事故快照——本服务不越域反查 incidents 表
 * （铁律③），需要的字段由调用方（incident.service.ts 的 assess，Task 5）直接给。 */
export interface OpenForIncidentInput {
  incidentNo: string;
  type: string;
  title: string;
  createdAt: Date;
  customerNo?: string | null;
  traceId: string;
}

@Injectable()
export class RegulatoryFilingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accessControl: AccessControlService,
  ) {}

  // ── 族独占断言（T3，照 incident.service.ts 的 assertOperator 先例）───────────
  // 精确判定 actor 是否持有该单据类型所属族的能力码（cap.filing.general/cap.filing.aml）；
  // 不做「码反查所属组」——理由同 incidents 头注释：码若被多组共享会把持有人一并抬进
  // 共享的另一组。GET 两条只读端点不经本断言（读放行，见 spec §6）。
  private async assertFamily(cfg: FilingTypeConfig, actor: ApprovalActorContext): Promise<void> {
    const code = FILING_FAMILY_CAPABILITY_CODE[cfg.family];
    const allowed = await this.accessControl.hasPermission(actor.userId, code);
    if (!allowed) {
      throw new ForbiddenException(`Actor lacks filing capability "${code}" required for ${cfg.family} filings (${cfg.label})`);
    }
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(filingNo: string): Promise<RegulatoryFiling> {
    const row = await this.prisma.regulatoryFiling.findUnique({ where: { filingNo } });
    if (!row) throw new NotFoundException(`Regulatory filing not found: ${filingNo}`);
    return row;
  }

  /** 列表：铁律⑥投影，零 id。 */
  async list(q: { status?: string; type?: string; incidentNo?: string }) {
    const where: Record<string, unknown> = {
      ...(q.status && { status: q.status }),
      ...(q.type && { type: q.type }),
      ...(q.incidentNo && { incidentNo: q.incidentNo }),
    };
    const rows = await this.prisma.regulatoryFiling.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toListItem(r));
  }

  private toListItem(row: RegulatoryFiling) {
    return {
      filingNo: row.filingNo, direction: row.direction, type: row.type, status: row.status,
      authority: row.authority, ccAuthorities: row.ccAuthorities ? row.ccAuthorities.split(',') : [],
      basisCode: row.basisCode ?? null, incidentNo: row.incidentNo ?? null, title: row.title,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
      externalRef: row.externalRef ?? null,
      // T3修1（评审黄2）：报文族外部案件引用（Sumsub/EOCN，openManual/openForSanction 落库）
      // 此前只落库、投影不吐，T9 报送台前端拿不到数据源——加进列表投影（开单即有值）。
      externalCaseRef: row.externalCaseRef ?? null,
      submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
      overdueMarkedAt: row.overdueMarkedAt ? row.overdueMarkedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 详情：主体字段 + 往来记录——铁律⑥投影，零 id。 */
  async getView(filingNo: string) {
    const row = await this.findByNo(filingNo);
    const entries = await this.prisma.regulatoryFilingEntry.findMany({ where: { filingId: row.id }, orderBy: { createdAt: 'asc' } });
    return {
      ...this.toListItem(row),
      body: row.body ?? null,
      submittedByUserId: row.submittedByUserId ?? null,
      approvalNo: row.approvalNo ?? null,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      cancelledReason: row.cancelledReason ?? null,
      // T3修1（评审黄2）：「决定不报」理由——同 cancelledReason 一样是终态专属字段，
      // 只在详情投影出现（列表页不需要）；closeNoFiling 落库后此前 getView 不吐，T9
      // 报送台前端渲染不报结案理由拿不到数据源。
      noFilingReason: row.noFilingReason ?? null,
      createdByUserId: row.createdByUserId,
      entries: entries.map((e) => ({
        kind: e.kind, body: e.body, externalRef: e.externalRef ?? null,
        recordedByUserId: e.recordedByUserId, createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** 事故详情页的通报清单（spec §4）：只读投影，供 incidents 侧横向展示。 */
  async summaryForIncident(incidentNo: string): Promise<Array<{
    filingNo: string; status: string; authority: string; basisCode: string | null;
    deadlineAt: string | null; overdueMarkedAt: string | null; submittedAt: string | null;
  }>> {
    const rows = await this.prisma.regulatoryFiling.findMany({ where: { incidentNo }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      filingNo: r.filingNo, status: r.status, authority: r.authority, basisCode: r.basisCode ?? null,
      deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
      overdueMarkedAt: r.overdueMarkedAt ? r.overdueMarkedAt.toISOString() : null,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    }));
  }

  // ── 迁移守卫（T3：改按族读表，spec §3 点 2）───────────────────────────

  private assertFilingTransition(family: 'GENERAL' | 'AML', from: string, to: string): void {
    const allowed = FILING_TRANSITIONS_BY_FAMILY[family][from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Invalid filing transition ${from} → ${to}`);
  }

  private async transition(row: RegulatoryFiling, to: string, patch: Record<string, unknown> = {}): Promise<RegulatoryFiling> {
    const { family } = getFilingTypeConfig(row.type);
    this.assertFilingTransition(family, row.status, to);
    return this.prisma.regulatoryFiling.update({ where: { filingNo: row.filingNo }, data: { status: to, ...patch } });
  }

  /** 钟锚计算（spec §4；T3 扩 EXTERNAL 分支＋工作日单位，spec §3 点 1）：INCIDENT_REPORT
   * 按依据码（从事故登记时刻起算，chainStart='NOTICE' 或 hours=null 时钟链未落定，留
   * null）；EXTERNAL 锚（CNMR/PNMR）按 workflow 外传的 anchorAt + deadlineBusinessDays 个
   * 工作日（手工开单不传 anchorAt 时留 null，不杜撰——锚只能来自 workflow 外传）；其余类型
   * 按类型默认小时钟（从来函收到时刻起算，缺 receivedAt 退化到当前时刻，GENERAL 族既有行为
   * 零漂移）；都没有时限依据则 null。 */
  private computeDeadline(
    cfg: FilingTypeConfig,
    basisCode: string | undefined,
    anchors: { incidentCreatedAt?: Date; receivedAt?: Date; externalAnchorAt?: Date },
  ): Date | null {
    if (cfg.requiresIncident) {
      if (!basisCode) return null;
      const base = INCIDENT_REPORT_BASES[basisCode];
      if (!base || base.hours == null || base.chainStart === 'NOTICE') return null;
      return new Date((anchors.incidentCreatedAt as Date).getTime() + base.hours * 3600 * 1000);
    }
    if (cfg.anchorKind === 'EXTERNAL') {
      if (!anchors.externalAnchorAt || cfg.deadlineBusinessDays == null) return null;
      return addBusinessDays(anchors.externalAnchorAt, cfg.deadlineBusinessDays);
    }
    if (cfg.defaultHours != null) {
      const start = anchors.receivedAt ?? new Date();
      return new Date(start.getTime() + cfg.defaultHours * 3600 * 1000);
    }
    return null;
  }

  // ── 开单（spec §4：一码=一单，双钟即两单）──────────────────────────

  /** 定损/登记流程按已勾选的依据码逐码开单（由 IncidentAssessmentWorkflowService.assess 调用，不经
   * workflow——通报是事故自己定损结论的直接产物，不是跨主体协作）。 */
  async openForIncident(incident: OpenForIncidentInput, basisCodes: string[], actor: ApprovalActorContext): Promise<{ filingNos: string[] }> {
    const cfg = getFilingTypeConfig('INCIDENT_REPORT');
    const filingNos: string[] = [];
    for (const basisCode of basisCodes) {
      const base = INCIDENT_REPORT_BASES[basisCode];
      if (!base) throw new BadRequestException(`Unknown basis code: ${basisCode}`);
      const deadlineAt = this.computeDeadline(cfg, basisCode, { incidentCreatedAt: incident.createdAt });
      const traceId = randomUUID();
      const row = await this.prisma.regulatoryFiling.create({
        data: {
          filingNo: generateReferenceNo('FIL'), direction: cfg.direction, type: 'INCIDENT_REPORT',
          authority: base.authority, basisCode, incidentNo: incident.incidentNo,
          title: `${cfg.label} — ${incident.incidentNo}`,
          deadlineAt, status: FilingStatus.DRAFT,
          createdByUserId: actor.userNo ?? actor.userId, traceId,
        },
      });
      filingNos.push(row.filingNo);

      const extraSubjects: AuditSubjectInput[] = [
        { subjectType: AuditEntityTypes.INCIDENT, subjectNo: incident.incidentNo, subjectRole: AuditSubjectRole.RELATED },
      ];
      if (incident.customerNo) extraSubjects.push({ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: incident.customerNo, subjectRole: AuditSubjectRole.OWNER });

      await this.recordAudit(row, AuditActions.FILING_OPENED, actor, {
        metadata: {
          source: 'INCIDENT_ASSESSMENT', incidentNo: incident.incidentNo, basisCode,
          authority: base.authority, deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
        },
        extra: { type: 'INCIDENT_REPORT' },
        extraSubjects,
      });
    }
    return { filingNos };
  }

  /** 手工开单（合规官/MLRO 直调，不经 workflow——校验全在本方法）。T3：先过族独占断言
   * （合规官开不动 STR/CNMR 等 AML 类型——T1 评审白4 点名的窗口，本方法就是它的关闭点）；
   * INCIDENT_REPORT 类型必须带 incidentNo/basisCode，basisCode 必须是该事故类型注册表
   * 允许的依据码，且确实是已知依据码；其余类型 authority 必须给（或有注册表默认值）且
   * 落在机构目录内；requiresExternalCaseRef 类型（STR/SAR/CNMR/PNMR）externalCaseRef
   * 缺失即 400。EXTERNAL 锚类型（CNMR/PNMR）手工开单不传 anchorAt，deadline 留 null
   * （锚只能来自 openForSanction 的 workflow 外传，不杜撰）。 */
  async openManual(dto: OpenFilingDto, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    const cfg = getFilingTypeConfig(dto.type);
    await this.assertFamily(cfg, actor);
    if (cfg.requiresExternalCaseRef && !dto.externalCaseRef) {
      throw new BadRequestException(`Filing type ${dto.type} requires an externalCaseRef`);
    }
    let authority: string | null = null;
    let incidentCreatedAt: Date | undefined;
    let customerNo: string | null = null;

    if (cfg.requiresIncident) {
      if (!dto.incidentNo || !dto.basisCode) {
        throw new BadRequestException(`${dto.type} filing requires incidentNo and basisCode`);
      }
      const incident = await this.prisma.incident.findUnique({ where: { incidentNo: dto.incidentNo } });
      if (!incident) throw new NotFoundException(`Incident not found: ${dto.incidentNo}`);
      const typeCfg = INCIDENT_TYPE_REGISTRY[incident.type];
      if (!typeCfg || !typeCfg.reportBasisCandidates.includes(dto.basisCode)) {
        throw new BadRequestException(`Basis code ${dto.basisCode} is not a valid reporting basis for incident type ${incident.type}`);
      }
      const base = INCIDENT_REPORT_BASES[dto.basisCode];
      if (!base) throw new BadRequestException(`Unknown basis code: ${dto.basisCode}`);
      authority = base.authority;
      incidentCreatedAt = incident.createdAt;
      customerNo = incident.customerNo ?? null;
    } else {
      authority = dto.authority ?? cfg.defaultAuthority;
      if (!authority) throw new BadRequestException(`Filing type ${dto.type} requires an authority`);
      if (!(authority in RegulatoryAuthorities)) throw new BadRequestException(`Unknown regulatory authority: ${authority}`);
    }

    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : undefined;
    const deadlineAt = this.computeDeadline(cfg, dto.basisCode, { incidentCreatedAt, receivedAt });
    const traceId = randomUUID();
    const row = await this.prisma.regulatoryFiling.create({
      data: {
        filingNo: generateReferenceNo('FIL'), direction: cfg.direction, type: dto.type,
        authority,
        ccAuthorities: dto.ccAuthorities?.length ? dto.ccAuthorities.join(',') : null,
        basisCode: dto.basisCode ?? null, incidentNo: dto.incidentNo ?? null,
        title: dto.title ?? cfg.label,
        receivedAt: receivedAt ?? null,
        externalCaseRef: dto.externalCaseRef ?? null,
        deadlineAt, status: FilingStatus.DRAFT,
        createdByUserId: actor.userNo ?? actor.userId, traceId,
      },
    });

    const extraSubjects: AuditSubjectInput[] = [];
    if (dto.incidentNo) extraSubjects.push({ subjectType: AuditEntityTypes.INCIDENT, subjectNo: dto.incidentNo, subjectRole: AuditSubjectRole.RELATED });
    if (customerNo) extraSubjects.push({ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: AuditSubjectRole.OWNER });

    await this.recordAudit(row, AuditActions.FILING_OPENED, actor, {
      metadata: {
        source: 'MANUAL',
        ...(dto.incidentNo ? { incidentNo: dto.incidentNo } : {}),
        ...(dto.basisCode ? { basisCode: dto.basisCode } : {}),
        authority: row.authority, deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
      },
      extra: { type: dto.type },
      extraSubjects,
    });

    return { filingNo: row.filingNo };
  }

  // ── 草案（spec §5：首次记审计，续存不重记，照 incident.saveReportDraft 先例）───

  async saveDraft(filingNo: string, body: string, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    const row = await this.findByNo(filingNo);
    await this.assertFamily(getFilingTypeConfig(row.type), actor);
    const isFirst = !row.body;
    const updated = await this.prisma.regulatoryFiling.update({ where: { filingNo }, data: { body } });
    if (isFirst) {
      await this.recordAudit(updated, AuditActions.FILING_DRAFT_SAVED, actor, { reason: 'Drafted filing body' });
    }
    return { filingNo };
  }

  // ── 签发（spec §5：DRAFT→PENDING_SIGNOFF→SIGNED_OFF/DRAFT，审批裁决驱动）───────

  /** T3修1（评审红1）：workflow 的 submitForSignoff 在 approvals.createAndSubmit（造一张
   * 真审批单，一旦造出就留痕在案）之前必须先过这道只读预检——否则被拒的送签（族门/边
   * 校验）会先留下一张真审批单，AML 单内容漏进高管审批链。判据与 markSignoffRequested
   * 真正推进时用的完全一致（assertFamily + 族表 DRAFT→PENDING_SIGNOFF 边），本方法只是
   * 抽出来给 workflow 单独调用——不落库、不推进状态、不记审计，workflow 里不复制判据。 */
  async assertSignoffAllowed(filingNo: string, actor: ApprovalActorContext): Promise<RegulatoryFiling> {
    const row = await this.findByNo(filingNo);
    const cfg = getFilingTypeConfig(row.type);
    await this.assertFamily(cfg, actor);
    // AML 族的 DRAFT 出边不含 PENDING_SIGNOFF（T1 族边集拆分）——送签即非法跃迁，显式拒绝
    // （spec §3 点 2：AML 无签发链）。
    this.assertFilingTransition(cfg.family, row.status, FilingStatus.PENDING_SIGNOFF);
    return row;
  }

  async markSignoffRequested(filingNo: string, approvalNo: string, actor: ApprovalActorContext): Promise<void> {
    const row = await this.assertSignoffAllowed(filingNo, actor);
    const updated = await this.transition(row, FilingStatus.PENDING_SIGNOFF, { approvalNo });
    await this.recordAudit(updated, AuditActions.FILING_SIGNOFF_REQUESTED, actor, {
      fromStatus: row.status, toStatus: updated.status, approvalNo,
    });
  }

  /** 审批裁决落地——异步驱动，无 actor（照 incident-close-workflow.closeAudit 的
   * recordSystem 先例）。APPROVED → SIGNED_OFF；DECLINED/CANCELLED/EXPIRED 打回 DRAFT。 */
  async applySignoffDecision(
    filingNo: string,
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED',
    event: { approvalNo: string; approvalId: string; decisionReason?: string | null },
  ): Promise<void> {
    const row = await this.findByNo(filingNo);
    if (decision === 'APPROVED') {
      const updated = await this.transition(row, FilingStatus.SIGNED_OFF);
      await this.recordAudit(updated, AuditActions.FILING_SIGNED_OFF, null, {
        fromStatus: row.status, toStatus: updated.status,
        approvalNo: event.approvalNo, causationId: event.approvalId,
      });
      return;
    }
    const updated = await this.transition(row, FilingStatus.DRAFT);
    await this.recordAudit(updated, AuditActions.FILING_SIGNOFF_REJECTED, null, {
      fromStatus: row.status, toStatus: updated.status,
      approvalNo: event.approvalNo, causationId: event.approvalId,
      reason: event.decisionReason ?? decision,
    });
  }

  // ── 提交（spec §6：落外部编号；同事故 NOTICE 钟链单在此落定 deadline）─────────

  async markSubmitted(filingNo: string, dto: MarkFilingSubmittedDto, actor: ApprovalActorContext): Promise<{ filingNo: string; chainDeadlineSetFor: string[] }> {
    // externalRef 前置闸原样（T3 未改）：先于族/状态机检查，与既有测试口径一致。
    if (!dto?.externalRef) throw new BadRequestException('Marking a filing as submitted requires an externalRef');
    const row = await this.findByNo(filingNo);
    // AML 族 DRAFT→SUBMITTED 是族边集里的合法边（T1），故 MLRO 对 DRAFT 态 AML 单调
    // markSubmitted 会直接落地——无需先过 PENDING_SIGNOFF/SIGNED_OFF 两态（spec §3 点 2）。
    await this.assertFamily(getFilingTypeConfig(row.type), actor);
    const submittedAt = new Date();
    const updated = await this.transition(row, FilingStatus.SUBMITTED, {
      submittedAt, submittedByUserId: actor.userNo ?? actor.userId, externalRef: dto.externalRef,
    });

    // 同事故下还没落定时限、且依据码是 chainStart='NOTICE' 钟链码的兄弟单——本单的提交
    // 就是那只钟的起点（spec §4：钟链起点是"通知发出"时刻，不是定损/登记时刻）。
    const chainDeadlineSetFor: string[] = [];
    if (updated.incidentNo) {
      const siblings = await this.prisma.regulatoryFiling.findMany({
        where: { incidentNo: updated.incidentNo, deadlineAt: null, submittedAt: null, basisCode: { not: null } },
      });
      for (const sibling of siblings) {
        const base = INCIDENT_REPORT_BASES[sibling.basisCode as string];
        if (base && base.chainStart === 'NOTICE' && base.hours != null) {
          const deadlineAt = new Date(submittedAt.getTime() + base.hours * 3600 * 1000);
          await this.prisma.regulatoryFiling.update({ where: { filingNo: sibling.filingNo }, data: { deadlineAt } });
          chainDeadlineSetFor.push(sibling.filingNo);
        }
      }
    }

    await this.recordAudit(updated, AuditActions.FILING_SUBMITTED, actor, {
      fromStatus: row.status, toStatus: updated.status,
      extra: { externalRef: dto.externalRef },
      metadata: { chainDeadlineSetFor },
    });
    return { filingNo, chainDeadlineSetFor };
  }

  // ── 往来记录（spec §6：仅 SUBMITTED 可记）──────────────────────────────

  async addEntry(filingNo: string, dto: FilingEntryDto, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    const row = await this.findByNo(filingNo);
    await this.assertFamily(getFilingTypeConfig(row.type), actor);
    if (row.status !== FilingStatus.SUBMITTED) {
      throw new BadRequestException(`Filing ${filingNo} must be SUBMITTED to log a correspondence entry (current status: ${row.status})`);
    }
    if (!Object.values(FilingEntryKinds).includes(dto.kind as (typeof FilingEntryKinds)[keyof typeof FilingEntryKinds])) {
      throw new BadRequestException(`Unknown filing entry kind: ${dto.kind}`);
    }
    await this.prisma.regulatoryFilingEntry.create({
      data: { filingId: row.id, kind: dto.kind, body: dto.body, externalRef: dto.externalRef ?? null, recordedByUserId: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.FILING_ENTRY_LOGGED, actor, {
      extra: { kind: dto.kind }, metadata: { body: dto.body, externalRef: dto.externalRef ?? null },
    });
    return { filingNo };
  }

  // ── 结案 / 作废（spec §3：CLOSED 仅 SUBMITTED，CANCELLED 仅 DRAFT）─────────

  /** T3：DRAFT→CLOSED 边现已对 AML 族合法（表级，供 closeNoFiling 走），但 close() 是
   * 另一个动作，动作级维持仅 SUBMITTED 语义——不靠表隐式挡，显式判一次状态（评审黄项：
   * 防"法定必报单被无理由 Close"）。DRAFT 态单打 close 应 400，配行为单测。 */
  async close(filingNo: string, actor: ApprovalActorContext, note?: string): Promise<{ filingNo: string }> {
    const row = await this.findByNo(filingNo);
    await this.assertFamily(getFilingTypeConfig(row.type), actor);
    if (row.status !== FilingStatus.SUBMITTED) {
      throw new BadRequestException(`Invalid filing transition ${row.status} → ${FilingStatus.CLOSED} via close() (only a SUBMITTED filing can be closed this way; a DRAFT AML filing uses closeNoFiling instead)`);
    }
    const updated = await this.transition(row, FilingStatus.CLOSED, { closedAt: new Date() });
    await this.recordAudit(updated, AuditActions.FILING_CLOSED, actor, { fromStatus: row.status, toStatus: updated.status, reason: note });
    return { filingNo };
  }

  async cancel(filingNo: string, reason: string, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    if (!reason) throw new BadRequestException('Cancelling a filing requires a reason');
    const row = await this.findByNo(filingNo);
    await this.assertFamily(getFilingTypeConfig(row.type), actor);
    const updated = await this.transition(row, FilingStatus.CANCELLED, { cancelledReason: reason });
    await this.recordAudit(updated, AuditActions.FILING_CANCELLED, actor, { fromStatus: row.status, toStatus: updated.status, reason });
    return { filingNo };
  }

  /** T3 新方法（spec §3 点 2：「决定不报」新边）：DRAFT→CLOSED 唯本方法可走——close() 动作级
   * 只认 SUBMITTED（见上）。仅 allowNoFilingClose=true 的类型（STR/SAR）可走；CNMR/PNMR/
   * HRC/HRCA 等其余 AML 类型调用必须 400（T1 评审白5）。noFilingReason 空则 400——no-file
   * decision 的法定可辩护留痕（spec §2 A 线）。T3修1（评审黄1）：动作级另加显式 DRAFT-only
   * 守卫——AML 族表里 SUBMITTED→CLOSED 也是合法边（供既有 close() 走），若不加这道门，
   * 一张已提交带回执的 STR 也能被"决定不报"结案，跟"已提交"这个事实自相矛盾；已提交的单
   * 只能走 close()。 */
  async closeNoFiling(filingNo: string, noFilingReason: string, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    if (!noFilingReason) throw new BadRequestException('Closing a filing with a no-filing decision requires a noFilingReason');
    const row = await this.findByNo(filingNo);
    const cfg = getFilingTypeConfig(row.type);
    await this.assertFamily(cfg, actor);
    if (!cfg.allowNoFilingClose) {
      throw new BadRequestException(`Filing type ${row.type} does not allow a no-filing close`);
    }
    if (row.status !== FilingStatus.DRAFT) {
      throw new BadRequestException(`Invalid filing transition ${row.status} → ${FilingStatus.CLOSED} via closeNoFiling() (only a DRAFT filing can be closed this way; a SUBMITTED filing uses close() instead)`);
    }
    const updated = await this.transition(row, FilingStatus.CLOSED, { closedAt: new Date(), noFilingReason });
    // T3修1（评审黄2）：noFilingReason 除了满足 assertActionSpec 的顶层必填字段（extra），
    // 还要落进 reason 这一真实审计列（audit-logs.service.ts#recordByActor 只把白名单已知
    // 字段写进 AuditLogEvent 行，extra 里未在白名单的键——如这里的 noFilingReason 本身——
    // 只用来过 assertActionSpec 检查，不会被持久化；不带 reason 会让这条审计事件在
    // AuditLogEvent.reason 列上留空，「为什么决定不报」在审计台查不到）。
    await this.recordAudit(updated, AuditActions.FILING_CLOSED_NO_FILING, actor, {
      fromStatus: row.status, toStatus: updated.status,
      reason: noFilingReason,
      extra: { noFilingReason },
    });
    return { filingNo };
  }

  /** T3 新方法（spec §2 B 线 PARTIAL/CONFIRMED 出口）：供 T4 制裁定性 workflow 调用——
   * 本方法不建 workflow、不横向读客户/限制表（铁律③各管各的，入参由调用方直传快照）。
   * 仅 CNMR/PNMR 两类型；externalCaseRef（EOCN 名单条目引用）必填；deadline= addBusinessDays
   * (anchorAt, 5)（EXTERNAL 锚，spec §1②订正口径：CNMR 自冻结、PNMR 自暂停，均 5 个工作日）。
   * requestId 由调用方（workflow）显式传入，不在本方法内生成——同一次定性裁决落地时，
   * 客户限制主体与本单的审计写入共享同一个 requestId，把「哪次裁决触发了这张单」钉死
   * （铁律①操作必留痕）。 */
  async openForSanction(
    type: string,
    customerNo: string,
    externalCaseRef: string,
    anchorAt: Date,
    requestId: string,
    actor: ApprovalActorContext,
  ): Promise<{ filingNo: string }> {
    if (type !== 'CNMR' && type !== 'PNMR') {
      throw new BadRequestException(`openForSanction only supports CNMR/PNMR filing types, got ${type}`);
    }
    const cfg = getFilingTypeConfig(type);
    await this.assertFamily(cfg, actor);
    if (!externalCaseRef) throw new BadRequestException(`Filing type ${type} requires an externalCaseRef`);
    if (!requestId) throw new BadRequestException('openForSanction requires an explicit requestId');

    const deadlineAt = this.computeDeadline(cfg, undefined, { externalAnchorAt: anchorAt });
    const traceId = randomUUID();
    const row = await this.prisma.regulatoryFiling.create({
      data: {
        filingNo: generateReferenceNo('FIL'), direction: cfg.direction, type,
        authority: cfg.defaultAuthority as string,
        externalCaseRef,
        title: `${cfg.label} — ${customerNo}`,
        deadlineAt, status: FilingStatus.DRAFT,
        createdByUserId: actor.userNo ?? actor.userId, traceId,
      },
    });

    await this.recordAudit(row, AuditActions.FILING_OPENED, actor, {
      requestId,
      metadata: {
        source: 'SANCTION_DISPOSITION', customerNo, externalCaseRef,
        anchorAt: anchorAt.toISOString(), authority: row.authority,
        deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
      },
      extra: { type },
      extraSubjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: AuditSubjectRole.OWNER }],
    });
    return { filingNo: row.filingNo };
  }

  // ── 审计（十码共用信封；primarySubject 恒为 REGULATORY_FILING/filingNo，
  //     correlationId 恒继承 row.traceId——OPENED 铸的旅程）────────────────

  private async recordAudit(row: RegulatoryFiling, action: string, actor: ApprovalActorContext | null, patch: {
    reason?: string; fromStatus?: string; toStatus?: string;
    approvalNo?: string; causationId?: string;
    /** T3：跨主体 workflow（如 openForSanction）显式传入，与自己那份写入共享同一
     *  requestId，把「哪次裁决触发了这张单」钉死；不传则照旧自动铸一个（既有八法皆如此）。 */
    requestId?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
    extraSubjects?: AuditSubjectInput[];
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.REGULATORY_FILING, subjectNo: row.filingNo, subjectRole: AuditSubjectRole.PRIMARY },
      ...(patch.extraSubjects ?? []),
    ];
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.REGULATORY_FILING,
      primarySubjectType: AuditEntityTypes.REGULATORY_FILING, primarySubjectNo: row.filingNo,
      subjects,
      reason: patch.reason, fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      correlationId: row.traceId,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      requestId: patch.requestId ?? `${action}_${row.filingNo}_${randomUUID()}`,
      metadata: { filingNo: row.filingNo, type: row.type, ...(patch.metadata ?? {}) },
      sourcePlatform: actor ? 'ADMIN' : 'SYSTEM',
      ...(patch.extra ?? {}),
    };
    if (actor) {
      const display = actor.userNo ?? actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}
