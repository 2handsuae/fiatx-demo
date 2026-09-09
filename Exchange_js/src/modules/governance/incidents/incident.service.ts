// 平账三期 · 事故登记主体（spec §2/§5/§7）。
// 铁律③：本服务只写自己的三张表（incidents / incident_notes / incident_remediations）；
// 跨主体写回定性行（reconciliation_dispositions.incidentNo）不在本文件里做，见
// incident-registration-workflow.service.ts 的架构裁决。读其它主体的表（disposition /
// case / internalTransfer / reconciliationAdjustment / depositTransaction）是登记 / 挂载
// 前的存在性与口径校验，读不算跨主体写，留在本文件。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  AssessIncidentDto, EscalateIncidentDto, INCIDENT_REPORT_BASES, INCIDENT_TRANSITIONS,
  IncidentRemediationKinds, IncidentStatus, IncidentTypes, LinkRemediationDto,
  MarkReportedDto, RegisterIncidentDto,
} from './incident.constants';

@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  assertTransition(from: string, to: string): void {
    const allowed = INCIDENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal incident status transition: ${from} → ${to}`);
  }

  async findByNo(incidentNo: string) {
    const row = await (this.prisma as any).incident.findUnique({ where: { incidentNo } });
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
      (this.prisma as any).incident.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      (this.prisma as any).incident.count({ where }),
    ]);
    return { items: rows.map((r: any) => this.toListItem(r)), total };
  }

  private toListItem(row: any) {
    return {
      incidentNo: row.incidentNo, type: row.type, status: row.status, title: row.title,
      customerNo: row.customerNo ?? null, assetCode: row.assetCode ?? null,
      amount: row.amount != null ? row.amount.toString() : null,
      sourceCaseNo: row.sourceCaseNo ?? null,
      reportRequired: row.reportRequired, reportedAt: row.reportedAt ? row.reportedAt.toISOString() : null,
      reportDeadlineAt: row.reportDeadlineAt ? row.reportDeadlineAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 详情：主体字段 + 调查时间线（notes）+ 善后单列表——铁律⑥投影，零 id。 */
  async getView(incidentNo: string) {
    const row = await this.findByNo(incidentNo);
    const [notes, remediations, wallet] = await Promise.all([
      (this.prisma as any).incidentNote.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
      (this.prisma as any).incidentRemediation.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
      // walletRef 落的是 Wallet.id（内部 UUID，客户/平台户共用一张表，见 schema Wallet 注释）——
      // 铁律⑥翻译成 walletNo 业务键，惯例同 reconciliation-query.service.ts 的 walletRef→walletNo 投影。
      row.walletRef ? (this.prisma as any).wallet.findUnique({ where: { id: row.walletRef }, select: { walletNo: true } }) : null,
    ]);
    // Task 12：ADJUSTMENT 善后单要带上调账单状态——事故页「发起补款」按钮要判
    // 「挂载里有已落账（POSTED）认损调账单」，remediations 表本身不存这个状态
    // （挂载当时的快照会过期），只能反查调账单主体现状；批一次查，不是逐条 N+1。
    const adjustmentNos = remediations.filter((r: any) => r.kind === 'ADJUSTMENT').map((r: any) => r.referenceNo);
    const adjustmentStatusByNo = new Map<string, string>();
    if (adjustmentNos.length > 0) {
      const adjustments = await (this.prisma as any).reconciliationAdjustment.findMany({
        where: { adjustmentNo: { in: adjustmentNos } }, select: { adjustmentNo: true, status: true },
      });
      for (const a of adjustments) adjustmentStatusByNo.set(a.adjustmentNo, a.status);
    }
    return {
      incidentNo: row.incidentNo, type: row.type, status: row.status,
      title: row.title, description: row.description,
      sourceCaseNo: row.sourceCaseNo ?? null, sourceDispositionNo: row.sourceDispositionNo ?? null,
      sourceAdvanceTransferNo: row.sourceAdvanceTransferNo ?? null,
      walletNo: wallet?.walletNo ?? null, customerNo: row.customerNo ?? null, assetCode: row.assetCode ?? null,
      amount: row.amount != null ? row.amount.toString() : null,
      assessedAmount: row.assessedAmount != null ? row.assessedAmount.toString() : null,
      assessmentBasis: row.assessmentBasis ?? null,
      reportRequired: row.reportRequired,
      reportBasisCodes: row.reportBasisCodes ? row.reportBasisCodes.split(',') : [],
      reportDeadlineAt: row.reportDeadlineAt ? row.reportDeadlineAt.toISOString() : null,
      reportDraft: row.reportDraft ?? null,
      reportDraftedAt: row.reportDraftedAt ? row.reportDraftedAt.toISOString() : null,
      reportedAt: row.reportedAt ? row.reportedAt.toISOString() : null,
      reportReference: row.reportReference ?? null,
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
    const updated = await (this.prisma as any).incident.update({ where: { incidentNo }, data: { status: to, ...patch } });
    return { row, updated };
  }

  // ── 登记（四类校验，spec §5）──────────────────────────────────────────

  /**
   * 建事故单。写回定性行 `incidentNo` 不在这里做——铁律③跨主体写只在 workflow
   * （见 IncidentRegistrationWorkflowService.register，本方法是它编排的第一步）。
   */
  async register(dto: RegisterIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; traceId: string }> {
    if (!dto.title || !dto.description) throw new BadRequestException('Incident registration requires a title and a description');
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
      case IncidentTypes.MANUAL:
        break; // 只要 title+description，上面已校验
      default:
        throw new BadRequestException(`Unknown incident type: ${dto.type}`);
    }

    const traceId = randomUUID();
    const row = await (this.prisma as any).incident.create({
      data: {
        incidentNo: generateReferenceNo('INC'),
        type: dto.type,
        status: IncidentStatus.REGISTERED,
        title: dto.title,
        description: dto.description,
        sourceCaseNo: dto.sourceCaseNo ?? null,
        sourceDispositionNo: dto.sourceDispositionNo ?? null,
        sourceAdvanceTransferNo: dto.sourceAdvanceTransferNo ?? null,
        walletRef: dto.walletRef ?? null,
        customerNo: dto.customerNo ?? null,
        assetCode: dto.assetCode ?? null,
        amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : null,
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
    const disp = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dto.sourceDispositionNo } });
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
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.sourceCaseNo } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${dto.sourceCaseNo}`);
    if (!kase.slaBreached) throw new BadRequestException(`Case ${dto.sourceCaseNo} has not yet breached its aging deadline — it does not qualify for escalation to an incident`);
    // 评审修复（C1 挂接链）：可选行级校验——案件页 Escalate to incident 按钮带了
    // sourceDispositionNo 时，额外核实这行确实属于该案、且出口是「挂起·调查中」
    // （未带 sourceDispositionNo 的既有案级升级调用方维持原有行为，零破坏）。
    if (dto.sourceDispositionNo) {
      const disp = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dto.sourceDispositionNo } });
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
      const transfer = await (this.prisma as any).internalTransfer.findUnique({ where: { transferNo: dto.sourceAdvanceTransferNo } });
      if (!transfer) throw new NotFoundException(`Advance transfer not found: ${dto.sourceAdvanceTransferNo}`);
      if (transfer.purpose !== 'CLIENT_ADVANCE') throw new BadRequestException(`Transfer ${dto.sourceAdvanceTransferNo} is not an advance transfer (purpose=${transfer.purpose}) — it cannot anchor a shortfall incident`);
    }
  }

  // ── 调查（spec §2）────────────────────────────────────────────────────

  async startInvestigation(incidentNo: string, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string }> {
    const { row, updated } = await this.transition(incidentNo, IncidentStatus.INVESTIGATING);
    // fromStatus/toStatus 是 CreateAuditLogEventDto 的原生字段，requiredFields 校验直接读得到，不需要 extra。
    await this.recordAudit(updated, AuditActions.INCIDENT_INVESTIGATION_STARTED, actor, {
      fromStatus: row.status, toStatus: updated.status,
    });
    return { incidentNo, status: updated.status as string };
  }

  async addNote(incidentNo: string, body: string, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    if (!body) throw new BadRequestException('An investigation note requires content');
    const row = await this.findByNo(incidentNo);
    await (this.prisma as any).incidentNote.create({
      data: { incidentId: row.id, kind: 'NOTE', body, authorUserId: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.INCIDENT_NOTE_ADDED, actor, { reason: body, extra: { body } });
    return { incidentNo };
  }

  async escalate(incidentNo: string, dto: EscalateIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    if (!dto.to) throw new BadRequestException('Escalation requires a target');
    const row = await this.findByNo(incidentNo);
    await (this.prisma as any).incidentNote.create({
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
    const { row, updated } = await this.transition(incidentNo, IncidentStatus.WITHDRAWN, { withdrawnReason: reason });
    // reason 也是原生字段，INCIDENT_WITHDRAWN 的 requiredFields=['reason'] 直接读得到，不需要 extra。
    await this.recordAudit(updated, AuditActions.INCIDENT_WITHDRAWN, actor, {
      reason, fromStatus: row.status, toStatus: updated.status,
    });
    return { incidentNo, status: updated.status as string };
  }

  // ── 定损 + 通报留痕（spec §4/§7：72h 倒计时从事故登记时刻起算——Task 6）───────

  /**
   * 定损：INVESTIGATING → ASSESSED。reportRequired=true 必带非空且在
   * `INCIDENT_REPORT_BASES` 目录内的 reportBasisCodes；reportDeadlineAt = 事故登记时刻
   * （`incident.createdAt`，不是定损时刻——条款措辞"检测后 72h"，登记即检测记录）
   * + min(所选依据里有钟的 hours)；只选无钟依据（hours=null）时保持 null，不杜撰时限。
   */
  async assess(incidentNo: string, dto: AssessIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string; reportDeadlineAt: Date | null }> {
    if (!dto.assessedAmount || !dto.assessmentBasis) throw new BadRequestException('Assessment requires an assessed amount and a conclusion');
    const basisCodes = dto.reportRequired ? (dto.reportBasisCodes ?? []) : [];
    if (dto.reportRequired) {
      if (!basisCodes.length) throw new BadRequestException('A determination requiring reporting must include basis codes');
      for (const code of basisCodes) {
        if (!(code in INCIDENT_REPORT_BASES)) throw new BadRequestException(`Unknown basis code: ${code}`);
      }
    }
    const row = await this.findByNo(incidentNo);
    this.assertTransition(row.status, IncidentStatus.ASSESSED);
    const updated = await (this.prisma as any).incident.update({
      where: { incidentNo },
      data: {
        status: IncidentStatus.ASSESSED,
        assessedAmount: new Prisma.Decimal(dto.assessedAmount),
        assessmentBasis: dto.assessmentBasis,
        reportRequired: dto.reportRequired,
        reportBasisCodes: basisCodes.length ? basisCodes.join(',') : null,
        reportDeadlineAt: this.computeReportDeadline(row.createdAt, basisCodes),
      },
    });
    // requiredFields=['assessmentBasis']（INCIDENT_AUDIT_ACTIONS）——顶层传，assertActionSpec 直接读得到。
    await this.recordAudit(updated, AuditActions.INCIDENT_ASSESSED, actor, {
      fromStatus: row.status, toStatus: updated.status,
      extra: { assessmentBasis: dto.assessmentBasis },
      metadata: { assessedAmount: dto.assessedAmount, reportRequired: dto.reportRequired, reportBasisCodes: basisCodes },
    });
    return { incidentNo, status: updated.status as string, reportDeadlineAt: updated.reportDeadlineAt ?? null };
  }

  /** 只对选中依据里 hours 非 null 的取 min；全无钟则返回 null（界面显式「未设时限」）。 */
  private computeReportDeadline(createdAt: Date, basisCodes: string[]): Date | null {
    const hours = basisCodes
      .map((code) => (INCIDENT_REPORT_BASES as Record<string, { hours: number | null }>)[code]?.hours)
      .filter((h): h is number => h != null);
    if (!hours.length) return null;
    return new Date(createdAt.getTime() + Math.min(...hours) * 3600 * 1000);
  }

  /**
   * 存监管通报草案。首次落草案记 `INCIDENT_REGULATOR_REPORT_DRAFTED` 审计 + `reportDraftedAt`
   * （勘定结论：审计只证"何时开始起草"与"何时通报"两个时点）；再次保存只更新草案字段，不重记该码。
   */
  async saveReportDraft(incidentNo: string, draft: string, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    const row = await this.findByNo(incidentNo);
    const isFirst = !row.reportDraft;
    const patch: Record<string, unknown> = { reportDraft: draft };
    if (isFirst) patch.reportDraftedAt = new Date();
    const updated = await (this.prisma as any).incident.update({ where: { incidentNo }, data: patch });
    if (isFirst) {
      await this.recordAudit(updated, AuditActions.INCIDENT_REGULATOR_REPORT_DRAFTED, actor, {
        reason: 'Drafted regulator report',
      });
    }
    return { incidentNo };
  }

  /** 标已通报：前置 reportRequired && reportDraft 非空；落 reportedAt/reportedByUserId，软标不推状态。 */
  async markReported(incidentNo: string, dto: MarkReportedDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    const row = await this.findByNo(incidentNo);
    if (!row.reportRequired || !row.reportDraft) {
      throw new BadRequestException('Reporting must be determined required, and a report draft must already exist, before marking as reported');
    }
    const updated = await (this.prisma as any).incident.update({
      where: { incidentNo },
      data: { reportedAt: new Date(), reportedByUserId: actor.userNo ?? actor.userId, reportReference: dto.reference ?? null },
    });
    // requiredFields=['basisCodes']（spec §7 硬性要求）——值是落库同款逗号分隔字符串，非数组。
    await this.recordAudit(updated, AuditActions.INCIDENT_REGULATOR_REPORTED, actor, {
      reason: 'Regulator report completed', extra: { basisCodes: row.reportBasisCodes },
      metadata: { basisCodes: row.reportBasisCodes, reference: dto.reference ?? null },
    });
    return { incidentNo };
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
    const row = await this.findByNo(incidentNo);
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
      updated = await (this.prisma as any).incident.update({ where: { incidentNo }, data: { status: IncidentStatus.RESOLVING } });
      statusAdvanced = `${IncidentStatus.ASSESSED}→${IncidentStatus.RESOLVING}`;
    }

    await (this.prisma as any).incidentRemediation.create({
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
        const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo: referenceNo } });
        if (!row) throw new NotFoundException(`Adjustment not found: ${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.TRANSFER: {
        const row = await (this.prisma as any).internalTransfer.findUnique({ where: { transferNo: referenceNo } });
        if (!row) throw new NotFoundException(`Internal transfer not found: ${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.SUPPLEMENT:
      case IncidentRemediationKinds.CLAIM: {
        // 补录 / 退汇认领落地后都是一张充值单（depositNo）——B 批 disposition.supplementNo 回填的即此号。
        const row = await (this.prisma as any).depositTransaction.findUnique({ where: { depositNo: referenceNo } });
        if (!row) throw new NotFoundException(`Deposit not found: ${referenceNo}`);
        return;
      }
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
    const rows = await (this.prisma as any).incidentRemediation.findMany({ where: { incidentId: row.id } });
    return rows.map((r: any) => r.referenceNo as string);
  }

  /** 结案审批提交后回填 approvalNo——不推状态、不审计（workflow 记 INCIDENT_CLOSE_REQUESTED）。 */
  async markCloseRequested(incidentNo: string, approvalNo: string): Promise<void> {
    await (this.prisma as any).incident.update({ where: { incidentNo }, data: { approvalNo } });
  }

  /** ASSESSED/RESOLVING → CLOSED + closedAt——不审计（workflow 记 INCIDENT_CLOSED）。 */
  async close(incidentNo: string): Promise<{ incidentNo: string; status: string }> {
    const { updated } = await this.transition(incidentNo, IncidentStatus.CLOSED, { closedAt: new Date() });
    return { incidentNo, status: updated.status as string };
  }

  // ── 审计（十一码共用信封的当前子集：REGISTERED/INVESTIGATION_STARTED/NOTE_ADDED/
  //     ESCALATED/ASSESSED/REMEDIATION_LINKED/REGULATOR_REPORT_DRAFTED/REGULATOR_REPORTED/
  //     WITHDRAWN——CLOSE_REQUESTED/CLOSED 由 IncidentCloseWorkflowService 记，见上）──

  private async recordAudit(row: any, action: string, actor: ApprovalActorContext, patch: {
    reason?: string; fromStatus?: string; toStatus?: string; correlationId?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INCIDENT, subjectNo: row.incidentNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (row.customerNo) subjects.push({ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER });
    if (row.sourceCaseNo) subjects.push({ subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED });
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
