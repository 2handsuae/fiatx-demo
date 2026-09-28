// 平账三期 · 事故登记主体（spec §2/§5/§7）。
// 铁律③：本服务只写自己的三张表（incidents / incident_notes / incident_remediations）；
// 跨主体写回定性行（reconciliation_dispositions.incidentNo）不在本文件里做，见
// incident-registration-workflow.service.ts 的架构裁决。读其它主体的表（disposition /
// case / internalTransfer / reconciliationAdjustment / depositTransaction）是登记 / 挂载
// 前的存在性与口径校验，读不算跨主体写，留在本文件。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { AccessControlService } from '../../identity/access-control/access-control.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  AssessIncidentDto, EscalateIncidentDto, INCIDENT_REPORT_BASES, INCIDENT_TRANSITIONS,
  IncidentRemediationKinds, IncidentStatus, IncidentTypes, LinkRemediationDto,
  RegisterIncidentDto,
} from './incident.constants';
import { ASSESSMENT_BASIS_BY_SCHEME, getIncidentTypeConfig, IncidentTypeConfig, TOP_LEVEL_ANCHOR_KEYS } from './incident-type-registry';
// 战役甲波二 T6：getView 横向只读通报现状（铁律③读放行）——单槽六列（reportDeadlineAt/
// reportDraft/reportDraftedAt/reportedAt/reportedByUserId/reportReference）退役后，
// 事故详情页改查报送单主体的 summaryForIncident。RegulatoryFilingsModule 不 import
// IncidentsModule（filing 侧零事故依赖，入参靠调用方传行），单向依赖不成环。
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';

/** 战役甲波五 T4：CUSTOMER 族（当前仅 COMPLAINT_ESCALATION）只能经 registerFromComplaint
 *  （投诉升级 workflow 编排）落地，人工登记入口（register()）显式拒绝——门不可绕，手工
 *  登记拒绝清单本身是演示内容。 */
const MANUAL_REGISTRATION_BLOCKED_TYPES: ReadonlySet<string> = new Set([IncidentTypes.COMPLAINT_ESCALATION]);

@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accessControl: AccessControlService,
    private readonly filings: RegulatoryFilingService,
  ) {}

  // ── 经办桶断言（战役甲波一 T5，高危面；修1 Ruling-6 重设计）：register 与十个经办
  // 入口共用的门——按事故当前类型（或登记时的目标类型）取注册表 operatorMarkerCode
  // （族独占能力码，rbac.catalog.ts 的 cap.incident.* 五行，每码只挂一个组），
  // 用 hasPermission(userId, code) 精确判定 actor 是否持有这一个码（不做"权限码反查
  // 所属组"——码被多组共享时会把持有人一并抬进所有共享组，GET 路由码同属 READ/WRITE
  // 两组、T9 后 12 条 incident 路由码同属五桶，门就形同虚设，见 C1 Critical）。
  // 裁决 Ruling-5：不给 SUPER_ADMIN 开特例——`hasPermission` 自己对 SUPER_ADMIN 有角色码
  // 捷径（access-control.service.ts:216-218，直接 `roleCodes.includes('SUPER_ADMIN')` 返回
  // true，不需要真去查这一个 marker 码），天然通过，不用代码里特判。本方法保持
  // public——IncidentCloseWorkflowService 的 requestClose（结案入口，铁律③跨主体协作只在
  // workflow）复用它，省去第二次注入 AccessControlService（改动最小方案）。
  async assertOperator(cfg: IncidentTypeConfig, actor: ApprovalActorContext): Promise<void> {
    const allowed = await this.accessControl.hasPermission(actor.userId, cfg.operatorMarkerCode);
    if (!allowed) {
      throw new ForbiddenException(`Actor lacks operator capability "${cfg.operatorMarkerCode}" required for ${cfg.family} incidents (${cfg.label})`);
    }
  }

  /** 取现有事故行 + 按其现有类型做经办桶断言——investigation/notes/escalate/assess/remediations/withdraw 共用（甲波二 T6：saveReportDraft/markReported 随单槽退役，见下方审计块注释）。 */
  private async assertOperatorForIncident(incidentNo: string, actor: ApprovalActorContext) {
    const row = await this.findByNo(incidentNo);
    await this.assertOperator(getIncidentTypeConfig(row.type), actor);
    return row;
  }

  assertTransition(from: string, to: string): void {
    const allowed = INCIDENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal incident status transition: ${from} → ${to}`);
  }

  async findByNo(incidentNo: string) {
    const row = await this.prisma.incident.findUnique({ where: { incidentNo } });
    if (!row) throw new NotFoundException(`Incident not found: ${incidentNo}`);
    return row;
  }

  // ── 读（Task 8 补：列表 / 详情，HTTP 层薄转发要用——纯投影，不加业务规则）─────

  /** 列表：铁律⑥投影，零 id。 */
  async list(q: { status?: string; type?: string; customerNo?: string; sourceCaseNo?: string; skip?: number; take?: number }): Promise<{ items: ReturnType<IncidentService['toListItem']>[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.type && { type: q.type }),
      ...(q.customerNo && { customerNo: q.customerNo }),
      ...(q.sourceCaseNo && { sourceCaseNo: q.sourceCaseNo }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.incident.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.incident.count({ where }),
    ]);
    return { items: rows.map((r: any) => this.toListItem(r)), total };
  }

  private toListItem(row: any) {
    return {
      incidentNo: row.incidentNo, type: row.type, status: row.status, title: row.title,
      customerNo: row.customerNo ?? null, assetCode: row.assetCode ?? null,
      amount: row.amount != null ? row.amount.toString() : null,
      sourceCaseNo: row.sourceCaseNo ?? null,
      reportRequired: row.reportRequired,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 详情：主体字段 + 调查时间线（notes）+ 善后单列表——铁律⑥投影，零 id。 */
  async getView(incidentNo: string) {
    const row = await this.findByNo(incidentNo);
    const [notes, remediations, filings] = await Promise.all([
      this.prisma.incidentNote.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.incidentRemediation.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
      this.filings.summaryForIncident(row.incidentNo),
    ]);
    // Task 12：ADJUSTMENT 善后单要带上调账单状态——事故页「发起补款」按钮要判
    // 「挂载里有已落账（POSTED）认损调账单」，remediations 表本身不存这个状态
    // （挂载当时的快照会过期），只能反查调账单主体现状；批一次查，不是逐条 N+1。
    const adjustmentNos = remediations.filter((r: any) => r.kind === 'ADJUSTMENT').map((r: any) => r.referenceNo);
    const adjustmentStatusByNo = new Map<string, string>();
    if (adjustmentNos.length > 0) {
      const adjustments = await this.prisma.reconciliationAdjustment.findMany({
        where: { adjustmentNo: { in: adjustmentNos } }, select: { adjustmentNo: true, status: true },
      });
      for (const a of adjustments) adjustmentStatusByNo.set(a.adjustmentNo, a.status);
    }
    return {
      incidentNo: row.incidentNo, type: row.type, status: row.status,
      title: row.title, description: row.description,
      sourceCaseNo: row.sourceCaseNo ?? null, sourceDispositionNo: row.sourceDispositionNo ?? null,
      sourceAdvanceTransferNo: row.sourceAdvanceTransferNo ?? null,
      customerNo: row.customerNo ?? null, assetCode: row.assetCode ?? null,
      amount: row.amount != null ? row.amount.toString() : null,
      assessedAmount: row.assessedAmount != null ? row.assessedAmount.toString() : null,
      assessmentBasis: row.assessmentBasis ?? null,
      // 战役甲波一 T10（前端渲染必需，补 getView 投影缺口）：IMPACT 口径类型（CYBER_BCDR/
      // DATA_BREACH/OUTSOURCING_FAILURE/ASSET_NONCOMPLIANCE）的定损结果落在 impactSummary/
      // impactCount，此前只写不读（assess() 已落库，getView 未投影）——详情页判断"是否已
      // 定损"与渲染定损结果都读不到。subjectRefs 同理：register() 已落库（JSON 字符串），
      // close-workflow 的结案快照已经在解析回传（incident-close-workflow.service.ts:104），
      // 详情页锚字段区块（新七类）此前同样读不到。铁律⑥：三者业务值均非 UUID。
      impactSummary: row.impactSummary ?? null,
      impactCount: row.impactCount ?? null,
      subjectRefs: row.subjectRefs ? JSON.parse(row.subjectRefs) : null,
      reportRequired: row.reportRequired,
      reportBasisCodes: row.reportBasisCodes ? row.reportBasisCodes.split(',') : [],
      // 甲波二 T6：单槽六列退役——通报现状（草案/已提交/机构/时限）改由报送单主体自己的
      // 字段承载，横向只读挂这一个键，不再摊平进事故详情页顶层。
      filings,
      approvalNo: row.approvalNo ?? null,
      registeredBy: row.registeredByUserId,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      withdrawnReason: row.withdrawnReason ?? null,
      createdAt: row.createdAt.toISOString(),
      notes: notes.map((n: any) => ({
        kind: n.kind, escalatedTo: n.escalatedTo ?? null, body: n.body,
        authorBy: n.authorUserId, createdAt: n.createdAt.toISOString(),
      })),
      remediations: remediations.map((r: any) => ({
        kind: r.kind, referenceNo: r.referenceNo, linkedBy: r.linkedByUserId, createdAt: r.createdAt.toISOString(),
        status: r.kind === 'ADJUSTMENT' ? (adjustmentStatusByNo.get(r.referenceNo) ?? null) : null,
      })),
    };
  }

  private async transition(incidentNo: string, to: string, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(incidentNo);
    this.assertTransition(row.status, to);
    const updated = await this.prisma.incident.update({ where: { incidentNo }, data: { status: to, ...patch } });
    return { row, updated };
  }

  // ── 登记（四类校验，spec §5）──────────────────────────────────────────

  /**
   * 建事故单。写回定性行 `incidentNo` 不在这里做——铁律③跨主体写只在 workflow
   * （见 IncidentRegistrationWorkflowService.register，本方法是它编排的第一步）。
   */
  /**
   * 战役甲波五 T4（修复轮1，评审 Minor 2）：人工登记拒绝清单，抽成独立公开方法——
   * `IncidentRegistrationWorkflowService.register`（HTTP 入口的真正入口）也要在自己的
   * `assertOperator` 之前调用这个门，否则非运营 actor 会先吃 403、到不了这条 400（门被
   * 权限检查挡在前面，实质上从未真正生效）。`register()` 内部仍保留同一调用（两处都过、
   * 非互斥，同 `assertOperator` 双处调用的既有先例）。
   */
  assertManuallyRegistrable(type: string): void {
    if (MANUAL_REGISTRATION_BLOCKED_TYPES.has(type)) {
      throw new BadRequestException(`Incident type ${type} cannot be registered manually — it is only created via complaint escalation`);
    }
  }

  async register(dto: RegisterIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; traceId: string }> {
    if (!dto.title || !dto.description) throw new BadRequestException('Incident registration requires a title and a description');
    // 战役甲波五 T4：人工登记拒绝清单——先于 getIncidentTypeConfig（避免 enabled:true 之后
    // COMPLAINT_ESCALATION 从这道门溜进去）。registerFromComplaint 走独立方法，不受此清单约束。
    this.assertManuallyRegistrable(dto.type);
    // 未知/停用类型在这里先 400（getIncidentTypeConfig，T2）；经办桶断言先于任何类型专属
    // 校验（门不可绕）——存量三类维持原 switch 分支不变（行为回归），新七类落 default 分支
    // 走注册表锚键校验。
    const cfg = getIncidentTypeConfig(dto.type);
    await this.assertOperator(cfg, actor);
    switch (dto.type) {
      case IncidentTypes.UNAUTHORIZED_OUTFLOW:
        await this.assertUnauthorizedOutflow(dto);
        break;
      case IncidentTypes.LARGE_UNEXPLAINED:
        await this.assertLargeUnexplained(dto);
        break;
      case IncidentTypes.CLIENT_SHORTFALL:
        await this.assertClientShortfall(dto);
        break;
      default:
        this.assertAnchors(cfg, dto);
    }

    const traceId = randomUUID();
    const row = await this.prisma.incident.create({
      data: {
        incidentNo: generateReferenceNo('INC'),
        type: dto.type,
        status: IncidentStatus.REGISTERED,
        title: dto.title,
        description: dto.description,
        sourceCaseNo: dto.sourceCaseNo ?? null,
        sourceDispositionNo: dto.sourceDispositionNo ?? null,
        sourceAdvanceTransferNo: dto.sourceAdvanceTransferNo ?? null,
        customerNo: dto.customerNo ?? null,
        assetCode: dto.assetCode ?? null,
        amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null,
        subjectRefs: dto.subjectRefs ? JSON.stringify(dto.subjectRefs) : null,
        registeredByUserId: actor.userNo ?? actor.userId,
        traceId,
      },
    });

    // REGISTERED = S：起事故自己的旅程，correlationId 铸在这里（audit-actions.constant.ts 头注释）。
    await this.recordAudit(row, AuditActions.INCIDENT_REGISTERED, actor, {
      reason: dto.title, correlationId: traceId, extra: { type: dto.type },
    });
    return { incidentNo: row.incidentNo, traceId };
  }

  private async assertUnauthorizedOutflow(dto: RegisterIncidentDto): Promise<void> {
    if (!dto.sourceCaseNo || !dto.sourceDispositionNo) {
      throw new BadRequestException('An unauthorized-outflow incident requires a source case number and disposition line number');
    }
    const disp = await this.prisma.reconciliationDisposition.findUnique({ where: { dispositionNo: dto.sourceDispositionNo } });
    if (!disp) throw new NotFoundException(`Disposition line not found: ${dto.sourceDispositionNo}`);
    if (disp.outlet !== 'INCIDENT' || disp.causeCode !== 'UNAUTHORIZED_OUTFLOW') {
      throw new BadRequestException(`Disposition line ${dto.sourceDispositionNo} is not classified as unauthorized outflow (outlet=${disp.outlet}/causeCode=${disp.causeCode}) — this incident type cannot be registered against it`);
    }
    if (disp.incidentNo) {
      throw new BadRequestException(`Disposition line ${dto.sourceDispositionNo} is already linked to incident ${disp.incidentNo} — one line cannot carry two incidents`);
    }
  }

  private async assertLargeUnexplained(dto: RegisterIncidentDto): Promise<void> {
    if (!dto.sourceCaseNo) throw new BadRequestException('A large-unexplained incident requires a source case number');
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo: dto.sourceCaseNo } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${dto.sourceCaseNo}`);
    if (!kase.slaBreached) throw new BadRequestException(`Case ${dto.sourceCaseNo} has not yet breached its aging deadline — it does not qualify for escalation to an incident`);
    // 评审修复（C1 挂接链）：可选行级校验——案件页 Escalate to incident 按钮带了
    // sourceDispositionNo 时，额外核实这行确实属于该案、且出口是「挂起·调查中」
    // （未带 sourceDispositionNo 的既有案级升级调用方维持原有行为，零破坏）。
    if (dto.sourceDispositionNo) {
      const disp = await this.prisma.reconciliationDisposition.findUnique({ where: { dispositionNo: dto.sourceDispositionNo } });
      if (!disp) throw new NotFoundException(`Disposition line not found: ${dto.sourceDispositionNo}`);
      if (disp.caseNo !== dto.sourceCaseNo) {
        throw new BadRequestException(`Disposition line ${dto.sourceDispositionNo} does not belong to case ${dto.sourceCaseNo} — this incident type cannot be registered against it`);
      }
      if (disp.outlet !== 'HOLD_INVESTIGATING') {
        throw new BadRequestException(`Disposition line ${dto.sourceDispositionNo} is not classified as "Hold · Investigating" (outlet=${disp.outlet}) — this incident type cannot be registered against it`);
      }
    }
  }

  private async assertClientShortfall(dto: RegisterIncidentDto): Promise<void> {
    if (!dto.customerNo || !dto.amount) throw new BadRequestException('A client-shortfall incident requires a customer number and an amount');
    if (dto.sourceAdvanceTransferNo) {
      const transfer = await this.prisma.internalTransfer.findUnique({ where: { transferNo: dto.sourceAdvanceTransferNo } });
      if (!transfer) throw new NotFoundException(`Advance transfer not found: ${dto.sourceAdvanceTransferNo}`);
      if (transfer.purpose !== 'CLIENT_ADVANCE') throw new BadRequestException(`Transfer ${dto.sourceAdvanceTransferNo} is not an advance transfer (purpose=${transfer.purpose}) — it cannot anchor a shortfall incident`);
    }
  }

  /**
   * 投诉升级专用入口（战役甲波五 T4）：CUSTOMER 族只能经这里创建（register() 的
   * MANUAL_REGISTRATION_BLOCKED_TYPES 挡了人工登记入口）。铁律③跨主体协作只在
   * workflow——ComplaintEscalationWorkflowService 调本方法完成事故落库，再自行调
   * ComplaintsService.markEscalated 回填投诉侧引用列；本方法不碰 complaints 表。
   * 走同一落库路径（经办桶断言 + 审计），审计复用既有 INCIDENT_REGISTERED 码，
   * metadata 额外带 complaintNo。注册表 requiredAnchors=['complaintNo','ownerCustomerNo']
   * 两键取自投诉主体自己的业务号——ownerCustomerNo 落存量 customerNo 列（与其它类型的
   * 客户锚一致，供审计 OWNER 主体与 list() 按客户过滤复用），complaintNo 落 subjectRefs
   * （类型专属回链锚，同 STUCK_TRANSACTION_MAJOR 的 orderNo 惯例）；两键名不同构于
   * TOP_LEVEL_ANCHOR_KEYS，故不复用通用 assertAnchors，改显式必填校验。
   */
  async registerFromComplaint(
    actor: ApprovalActorContext,
    dto: { complaintNo: string; ownerCustomerNo: string; title: string; description: string },
  ): Promise<{ incidentNo: string }> {
    if (!dto.complaintNo || !dto.ownerCustomerNo || !dto.title || !dto.description) {
      throw new BadRequestException('Complaint escalation registration requires complaintNo, ownerCustomerNo, title and description');
    }
    const cfg = getIncidentTypeConfig(IncidentTypes.COMPLAINT_ESCALATION);
    await this.assertOperator(cfg, actor);

    const traceId = randomUUID();
    const row = await this.prisma.incident.create({
      data: {
        incidentNo: generateReferenceNo('INC'),
        type: IncidentTypes.COMPLAINT_ESCALATION,
        status: IncidentStatus.REGISTERED,
        title: dto.title,
        description: dto.description,
        customerNo: dto.ownerCustomerNo,
        subjectRefs: JSON.stringify({ complaintNo: dto.complaintNo }),
        registeredByUserId: actor.userNo ?? actor.userId,
        traceId,
      },
    });

    await this.recordAudit(row, AuditActions.INCIDENT_REGISTERED, actor, {
      reason: dto.title, correlationId: traceId,
      extra: { type: IncidentTypes.COMPLAINT_ESCALATION },
      metadata: { complaintNo: dto.complaintNo },
      // 评审 Minor 4（修复轮1）：审计 subjects 加投诉自己的 RELATED 主体——审计台按
      // 投诉号（complaintNo）能查到这次登记，不必先知道事故号才能反查。
      extraSubjects: [{ subjectType: AuditEntityTypes.COMPLAINT, subjectNo: dto.complaintNo, subjectRole: AuditSubjectRole.RELATED }],
    });
    return { incidentNo: row.incidentNo };
  }

  // 甲波一 T5 修1（Ruling-8，I2 修复）：requiredAnchors 里与存量列同名的三个键
  // （assetCode/customerNo/amount，见 incident-type-registry.ts 导出的 TOP_LEVEL_ANCHOR_KEYS）
  // 改源——这三列是审计主体挂载与按客户筛选靠的存量列（见 recordAudit/list()），值必须从
  // DTO 顶层取、落存量列，不许塞进 subjectRefs 造出"同一份数据两个存放位置"的分裂。其余键
  // （新类型专属，如 affectedSystem/dataCategories/orderNo/metric 等）继续从 subjectRefs 取。

  /**
   * 新七类锚键校验（注册表 requiredAnchors 驱动）：缺键/空串一律 400，报缺哪个键。
   * 甲波一 T5 修2（Ruling-8 修订，小修 b）：报错文案按取值位置分流——顶层键（存量列）说
   * "missing required field"，subjectRefs 键仍说"... in subjectRefs"（此前统一说
   * "in subjectRefs"，对顶层键是指错位置）。
   */
  private assertAnchors(cfg: IncidentTypeConfig, dto: RegisterIncidentDto): void {
    for (const key of cfg.requiredAnchors) {
      const isTopLevel = TOP_LEVEL_ANCHOR_KEYS.has(key);
      const value = isTopLevel ? (dto as unknown as Record<string, unknown>)[key] : dto.subjectRefs?.[key];
      if (value == null || value === '') {
        throw new BadRequestException(
          isTopLevel
            ? `Incident type ${dto.type} is missing required field ${key}`
            : `Incident type ${dto.type} requires anchor "${key}" in subjectRefs`,
        );
      }
    }
  }

  // ── 调查（spec §2）────────────────────────────────────────────────────

  async startInvestigation(incidentNo: string, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string }> {
    await this.assertOperatorForIncident(incidentNo, actor);
    const { row, updated } = await this.transition(incidentNo, IncidentStatus.INVESTIGATING);
    // fromStatus/toStatus 是 CreateAuditLogEventDto 的原生字段，requiredFields 校验直接读得到，不需要 extra。
    await this.recordAudit(updated, AuditActions.INCIDENT_INVESTIGATION_STARTED, actor, {
      fromStatus: row.status, toStatus: updated.status,
    });
    return { incidentNo, status: updated.status as string };
  }

  async addNote(incidentNo: string, body: string, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    if (!body) throw new BadRequestException('An investigation note requires content');
    const row = await this.assertOperatorForIncident(incidentNo, actor);
    await this.prisma.incidentNote.create({
      data: { incidentId: row.id, kind: 'NOTE', body, authorUserId: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.INCIDENT_NOTE_ADDED, actor, { reason: body, extra: { body } });
    return { incidentNo };
  }

  async escalate(incidentNo: string, dto: EscalateIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    if (!dto.to) throw new BadRequestException('Escalation requires a target');
    const row = await this.assertOperatorForIncident(incidentNo, actor);
    await this.prisma.incidentNote.create({
      data: { incidentId: row.id, kind: 'ESCALATION', escalatedTo: dto.to, body: dto.note, authorUserId: actor.userNo ?? actor.userId },
    });
    // escalatedTo 既是审计必填顶层字段（assertActionSpec 校验），也放进 metadata 便于审计台直接展示。
    await this.recordAudit(row, AuditActions.INCIDENT_ESCALATED, actor, {
      reason: dto.note, extra: { escalatedTo: dto.to }, metadata: { escalatedTo: dto.to },
    });
    return { incidentNo };
  }

  // ── 撤回（spec §2：仅 REGISTERED，误登记用，留审计不留橡皮擦）───────────

  async withdraw(incidentNo: string, reason: string, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string }> {
    if (!reason) throw new BadRequestException('Withdrawal requires a reason');
    await this.assertOperatorForIncident(incidentNo, actor);
    const { row, updated } = await this.transition(incidentNo, IncidentStatus.WITHDRAWN, { withdrawnReason: reason });
    // reason 也是原生字段，INCIDENT_WITHDRAWN 的 requiredFields=['reason'] 直接读得到，不需要 extra。
    await this.recordAudit(updated, AuditActions.INCIDENT_WITHDRAWN, actor, {
      reason, fromStatus: row.status, toStatus: updated.status,
    });
    return { incidentNo, status: updated.status as string };
  }

  // ── 定损（spec §4/§7：三档口径共用一个入口——Task 6）──────────────────────

  /**
   * 定损：INVESTIGATING → ASSESSED。三档口径（MONETARY/IMPACT/SHORTFALL）共用一个入口
   * （战役甲波一 Task 6，brief 行为合同）：
   * ① assessmentBasis 必须属于该事故类型 assessmentScheme 的合法集
   *   （`ASSESSMENT_BASIS_BY_SCHEME`，registry 文件）；
   * ② reportRequired=true 时 reportBasisCodes 必须是该类型 `cfg.reportBasisCandidates` 的子集
   *   （空候选集类型勾任何码即 400，如 ASSET_NONCOMPLIANCE）；
   * ③ MONETARY/SHORTFALL 口径必填 assessedAmount，IMPACT 口径必填 impactSummary。
   * 新增校验放在经办门（`assertOperatorForIncident`）之后、迁移守卫（`assertTransition`）
   * 之前——需要 `row.type` 才能取 cfg，经办门的 `findByNo` 顺带把行取到，不重复查询。
   *
   * 战役甲波二 T6：钟锚计算（原③"reportDeadlineAt = 登记时刻 + min(所选依据里数字钟)"）与
   * 落库整体迁到 `RegulatoryFilingService.openForIncident`/`computeDeadline`——本方法只管
   * 判定本身（assessmentBasis/basisCodes 校验 + 落库 + 审计留痕），reportRequired=true 时
   * 逐码开报送单是 `IncidentAssessmentWorkflowService.assess`（铁律③跨主体协作在
   * workflow）编排的下一步，不在本方法内做。
   */
  async assess(incidentNo: string, dto: AssessIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string }> {
    const row = await this.assertOperatorForIncident(incidentNo, actor);
    const cfg = getIncidentTypeConfig(row.type);
    const allowedBases = ASSESSMENT_BASIS_BY_SCHEME[cfg.assessmentScheme];
    if (!dto.assessmentBasis || !allowedBases.includes(dto.assessmentBasis)) {
      throw new BadRequestException(`assessmentBasis must be one of [${allowedBases.join(', ')}] for ${cfg.assessmentScheme}-scheme incident type ${row.type}`);
    }
    if (cfg.assessmentScheme === 'IMPACT') {
      if (!dto.impactSummary) throw new BadRequestException('Assessment requires an impact summary');
    } else if (!dto.assessedAmount) {
      throw new BadRequestException('Assessment requires an assessed amount');
    }
    const basisCodes = dto.reportRequired ? (dto.reportBasisCodes ?? []) : [];
    if (dto.reportRequired) {
      if (!basisCodes.length) throw new BadRequestException('A determination requiring reporting must include basis codes');
      for (const code of basisCodes) {
        if (!(code in INCIDENT_REPORT_BASES)) throw new BadRequestException(`Unknown basis code: ${code}`);
        if (!cfg.reportBasisCandidates.includes(code)) throw new BadRequestException(`Basis code ${code} is not a valid reporting basis for incident type ${row.type}`);
      }
    }
    this.assertTransition(row.status, IncidentStatus.ASSESSED);
    const updated = await this.prisma.incident.update({
      where: { incidentNo },
      data: {
        status: IncidentStatus.ASSESSED,
        assessedAmount: dto.assessedAmount ? new Prisma.Decimal(dto.assessedAmount) : null,
        assessmentBasis: dto.assessmentBasis,
        impactSummary: dto.impactSummary ?? null,
        impactCount: dto.impactCount ?? null,
        reportRequired: dto.reportRequired,
        reportBasisCodes: basisCodes.length ? basisCodes.join(',') : null,
      },
    });
    // requiredFields=['assessmentBasis']（INCIDENT_AUDIT_ACTIONS）——顶层传，assertActionSpec 直接读得到。
    await this.recordAudit(updated, AuditActions.INCIDENT_ASSESSED, actor, {
      fromStatus: row.status, toStatus: updated.status,
      extra: { assessmentBasis: dto.assessmentBasis },
      metadata: {
        assessedAmount: dto.assessedAmount ?? null, impactSummary: dto.impactSummary ?? null,
        impactCount: dto.impactCount ?? null, reportRequired: dto.reportRequired, reportBasisCodes: basisCodes,
      },
    });
    return { incidentNo, status: updated.status as string };
  }

  // ── 善后挂载（spec §5：只校验单号存在，不管账，不管归属校验之外的东西）────

  /**
   * 只许在 ASSESSED 或 RESOLVING 挂善后单（定损口径决定善后动作，定损前挂单无业务意义）。
   * Task 7 裁决修复：`ASSESSED→RESOLVING`（`INCIDENT_TRANSITIONS` 已登记的边）此前无任何
   * 公开方法触发——十一码审计合同锁死，没有"开始处置"独立码位（见 task-7-report.md）；
   * 裁决把这条迁移搭在首次善后挂载上：ASSESSED 时挂载经 `assertTransition` 走迁移表同步推
   * 状态到 RESOLVING（铁律④），已是 RESOLVING 则只追加挂载。审计仍用既有
   * `INCIDENT_REMEDIATION_LINKED` 一条（不加码），发生迁移时 metadata 带 statusAdvanced。
   */
  async linkRemediation(incidentNo: string, dto: LinkRemediationDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    const row = await this.assertOperatorForIncident(incidentNo, actor);
    const cfg = getIncidentTypeConfig(row.type);
    if (!cfg.allowedRemediationKinds.includes(dto.kind)) {
      throw new BadRequestException(
        `Remediation kind ${dto.kind} is not allowed for ${row.type} incidents (allowed: ${cfg.allowedRemediationKinds.join(', ') || 'none'})`,
      );
    }
    if (row.status !== IncidentStatus.ASSESSED && row.status !== IncidentStatus.RESOLVING) {
      if (row.status === IncidentStatus.CLOSED) {
        throw new BadRequestException(`Incident ${incidentNo} is already closed — no more remediation can be linked`);
      }
      if (row.status === IncidentStatus.WITHDRAWN) {
        throw new BadRequestException(`Incident ${incidentNo} has been withdrawn — remediation cannot be linked`);
      }
      throw new BadRequestException(`Incident has not been assessed yet — remediation cannot be linked until assessment is complete (current status: ${row.status})`);
    }
    await this.assertRemediationReferenceExists(dto.kind, dto.referenceNo);

    let updated = row;
    let statusAdvanced: string | undefined;
    if (row.status === IncidentStatus.ASSESSED) {
      this.assertTransition(row.status, IncidentStatus.RESOLVING);
      updated = await this.prisma.incident.update({ where: { incidentNo }, data: { status: IncidentStatus.RESOLVING } });
      statusAdvanced = `${IncidentStatus.ASSESSED}→${IncidentStatus.RESOLVING}`;
    }

    await this.prisma.incidentRemediation.create({
      data: { incidentId: row.id, kind: dto.kind, referenceNo: dto.referenceNo, linkedByUserId: actor.userNo ?? actor.userId },
    });
    // 发生迁移时按 assess() 样板同填 fromStatus/toStatus（本仓库记录状态边的规范列）；
    // RESOLVING 上纯追加时没有状态边，两列留空。
    await this.recordAudit(updated, AuditActions.INCIDENT_REMEDIATION_LINKED, actor, {
      reason: `Linked remediation ${dto.referenceNo} (${dto.kind})`, extra: { referenceNo: dto.referenceNo },
      ...(statusAdvanced ? { fromStatus: row.status, toStatus: updated.status } : {}),
      metadata: { kind: dto.kind, referenceNo: dto.referenceNo, ...(statusAdvanced ? { statusAdvanced } : {}) },
    });
    return { incidentNo };
  }

  private async assertRemediationReferenceExists(kind: string, referenceNo: string): Promise<void> {
    switch (kind) {
      case IncidentRemediationKinds.ADJUSTMENT: {
        const row = await this.prisma.reconciliationAdjustment.findUnique({ where: { adjustmentNo: referenceNo } });
        if (!row) throw new NotFoundException(`Adjustment not found: ${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.TRANSFER: {
        const row = await this.prisma.internalTransfer.findUnique({ where: { transferNo: referenceNo } });
        if (!row) throw new NotFoundException(`Internal transfer not found: ${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.SUPPLEMENT:
      case IncidentRemediationKinds.CLAIM: {
        // 补录 / 退汇认领落地后都是一张充值单（depositNo）——B 批 disposition.supplementNo 回填的即此号。
        const row = await this.prisma.depositTransaction.findUnique({ where: { depositNo: referenceNo } });
        if (!row) throw new NotFoundException(`Deposit not found: ${referenceNo}`);
        return;
      }
      // 战役甲波一 Task 7 +2：以下两种只登记引用，不做存在性查询——ASSET_SUSPENSION_REF
      // 指向审批主体的既有暂停单号（事件侧不代办不越域查询，铁律③）；CUSTOMER_NOTICE_LOGGED
      // 是自由留痕串（通知本体是死码，丙战役后升级）。
      case IncidentRemediationKinds.ASSET_SUSPENSION_REF:
      case IncidentRemediationKinds.CUSTOMER_NOTICE_LOGGED:
        return;
      default:
        throw new BadRequestException(`Unknown remediation type: ${kind}`);
    }
  }

  // ── 结案支持方法（spec §7，Task 7）：三个纯数据方法，供 IncidentCloseWorkflowService
  // 编排——审批本身是跨主体协作（铁律③），因此 requestClose/onDecided 的守卫、
  // objectSnapshot、审计（INCIDENT_CLOSE_REQUESTED/INCIDENT_CLOSED）都放在 workflow
  // 层，本服务只暴露它需要的三个读写原子，不掺一句审计（与 InternalTransferService/
  // WithdrawTransactionsService.markReturnClaimRequested 同款分工）。────────────────

  /** 结案前置校验要用到的善后单号清单（只读，spec §7"善后单号清单"字段的数据来源）。 */
  async findRemediations(incidentNo: string): Promise<string[]> {
    const row = await this.findByNo(incidentNo);
    const rows = await this.prisma.incidentRemediation.findMany({ where: { incidentId: row.id } });
    return rows.map((r: any) => r.referenceNo as string);
  }

  /** 结案审批提交后回填 approvalNo——不推状态、不审计（workflow 记 INCIDENT_CLOSE_REQUESTED）。 */
  async markCloseRequested(incidentNo: string, approvalNo: string): Promise<void> {
    await this.prisma.incident.update({ where: { incidentNo }, data: { approvalNo } });
  }

  /** ASSESSED/RESOLVING → CLOSED + closedAt——不审计（workflow 记 INCIDENT_CLOSED）。 */
  async close(incidentNo: string): Promise<{ incidentNo: string; status: string }> {
    const { updated } = await this.transition(incidentNo, IncidentStatus.CLOSED, { closedAt: new Date() });
    return { incidentNo, status: updated.status as string };
  }

  // ── 审计（甲波二 T6：单槽退役后九码共用信封的当前子集：REGISTERED/INVESTIGATION_STARTED/
  //     NOTE_ADDED/ESCALATED/ASSESSED/REMEDIATION_LINKED/WITHDRAWN——CLOSE_REQUESTED/CLOSED
  //     由 IncidentCloseWorkflowService 记，见上；原 REGULATOR_REPORT_DRAFTED/
  //     REGULATOR_REPORTED 两码随 saveReportDraft/markReported 一并退役，对应行为改由
  //     报送单主体自己的 FILING_DRAFT_SAVED/FILING_SUBMITTED 覆盖）──

  private async recordAudit(row: any, action: string, actor: ApprovalActorContext, patch: {
    reason?: string; fromStatus?: string; toStatus?: string; correlationId?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
    // 评审 Minor 4（甲波五 T4 修复轮1）：调用方按需追加的主体（如 registerFromComplaint
    // 的 COMPLAINT/RELATED——事故行本身没有 complaintNo 列，通用的 row.xxx 推断规则覆盖
    // 不到，只能由调用方显式传入）。
    extraSubjects?: AuditSubjectInput[];
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INCIDENT, subjectNo: row.incidentNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (row.customerNo) subjects.push({ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER });
    if (row.sourceCaseNo) subjects.push({ subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED });
    if (patch.extraSubjects) subjects.push(...patch.extraSubjects);
    const display = actor.userNo ?? actor.userId;
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.INCIDENT,
      primarySubjectType: AuditEntityTypes.INCIDENT, primarySubjectNo: row.incidentNo,
      ownerCustomerNo: row.customerNo ?? undefined, subjects,
      reason: patch.reason, fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      correlationId: patch.correlationId,
      requestId: `${action}_${row.incidentNo}_${randomUUID()}`,
      metadata: { incidentNo: row.incidentNo, type: row.type, ...(patch.metadata ?? {}) },
      sourcePlatform: 'ADMIN',
      ...(patch.extra ?? {}),
    };
    await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
  }
}
