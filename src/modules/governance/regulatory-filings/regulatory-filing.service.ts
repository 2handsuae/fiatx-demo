// 战役甲波二 · 报送台骨架（spec §3/§4/§5，Task 3）：主体 RegulatoryFiling 的核心服务。
// 铁律③：本服务只写自己的两张表（regulatory_filings / regulatory_filing_entries）；
// openManual('INCIDENT_REPORT') 对事故的读是校验用的横向只读（铁律③放行只读），不写。
// 模板：transition/recordAudit 形状照 incident.service.ts；无 actor 的审计（签发裁决驱动）
// 照 incident-close-workflow.service.ts 的 closeAudit 用 recordSystem 先例。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegulatoryFiling } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  FILING_TRANSITIONS, FilingEntryDto, FilingEntryKinds, FilingStatus,
  MarkFilingSubmittedDto, OpenFilingDto, RegulatoryAuthorities,
} from './regulatory-filing.constants';
import { FilingTypeConfig, getFilingTypeConfig } from './filing-type-registry';
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
  ) {}

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

  // ── 迁移守卫 ────────────────────────────────────────────────────────

  private assertFilingTransition(from: string, to: string): void {
    const allowed = FILING_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Invalid filing transition ${from} → ${to}`);
  }

  private async transition(row: RegulatoryFiling, to: string, patch: Record<string, unknown> = {}): Promise<RegulatoryFiling> {
    this.assertFilingTransition(row.status, to);
    return this.prisma.regulatoryFiling.update({ where: { filingNo: row.filingNo }, data: { status: to, ...patch } });
  }

  /** 钟锚计算（spec §4）：INCIDENT_REPORT 按依据码（从事故登记时刻起算，chainStart='NOTICE'
   * 或 hours=null 时钟链未落定，留 null）；其余类型按类型默认时限（从来函收到时刻起算，缺
   * receivedAt 退化到当前时刻）；两者都没有时限依据则 null（不杜撰）。 */
  private computeDeadline(
    cfg: FilingTypeConfig,
    basisCode: string | undefined,
    anchors: { incidentCreatedAt?: Date; receivedAt?: Date },
  ): Date | null {
    if (cfg.requiresIncident) {
      if (!basisCode) return null;
      const base = INCIDENT_REPORT_BASES[basisCode];
      if (!base || base.hours == null || base.chainStart === 'NOTICE') return null;
      return new Date((anchors.incidentCreatedAt as Date).getTime() + base.hours * 3600 * 1000);
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

  /** 手工开单（合规官直调，不经 workflow——校验全在本方法）。INCIDENT_REPORT 类型必须带
   * incidentNo/basisCode，basisCode 必须是该事故类型注册表允许的依据码，且确实是已知依据码。
   * 其余类型 authority 必须给（或有注册表默认值）且落在机构目录内。 */
  async openManual(dto: OpenFilingDto, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    const cfg = getFilingTypeConfig(dto.type);
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
    const isFirst = !row.body;
    const updated = await this.prisma.regulatoryFiling.update({ where: { filingNo }, data: { body } });
    if (isFirst) {
      await this.recordAudit(updated, AuditActions.FILING_DRAFT_SAVED, actor, { reason: 'Drafted filing body' });
    }
    return { filingNo };
  }

  // ── 签发（spec §5：DRAFT→PENDING_SIGNOFF→SIGNED_OFF/DRAFT，审批裁决驱动）───────

  async markSignoffRequested(filingNo: string, approvalNo: string, actor: ApprovalActorContext): Promise<void> {
    const row = await this.findByNo(filingNo);
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
    if (!dto?.externalRef) throw new BadRequestException('Marking a filing as submitted requires an externalRef');
    const row = await this.findByNo(filingNo);
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

  async close(filingNo: string, actor: ApprovalActorContext, note?: string): Promise<{ filingNo: string }> {
    const row = await this.findByNo(filingNo);
    const updated = await this.transition(row, FilingStatus.CLOSED, { closedAt: new Date() });
    await this.recordAudit(updated, AuditActions.FILING_CLOSED, actor, { fromStatus: row.status, toStatus: updated.status, reason: note });
    return { filingNo };
  }

  async cancel(filingNo: string, reason: string, actor: ApprovalActorContext): Promise<{ filingNo: string }> {
    if (!reason) throw new BadRequestException('Cancelling a filing requires a reason');
    const row = await this.findByNo(filingNo);
    const updated = await this.transition(row, FilingStatus.CANCELLED, { cancelledReason: reason });
    await this.recordAudit(updated, AuditActions.FILING_CANCELLED, actor, { fromStatus: row.status, toStatus: updated.status, reason });
    return { filingNo };
  }

  // ── 审计（十码共用信封；primarySubject 恒为 REGULATORY_FILING/filingNo，
  //     correlationId 恒继承 row.traceId——OPENED 铸的旅程）────────────────

  private async recordAudit(row: RegulatoryFiling, action: string, actor: ApprovalActorContext | null, patch: {
    reason?: string; fromStatus?: string; toStatus?: string;
    approvalNo?: string; causationId?: string;
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
      requestId: `${action}_${row.filingNo}_${randomUUID()}`,
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
