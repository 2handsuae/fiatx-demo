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
    if (!allowed.includes(to)) throw new BadRequestException(`事故单非法状态迁移：${from} → ${to}`);
  }

  async findByNo(incidentNo: string) {
    const row = await (this.prisma as any).incident.findUnique({ where: { incidentNo } });
    if (!row) throw new NotFoundException(`事故单不存在：${incidentNo}`);
    return row;
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
    if (!dto.title || !dto.description) throw new BadRequestException('事故登记必须带标题与说明');
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
        throw new BadRequestException(`未知事故类型：${dto.type}`);
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
      throw new BadRequestException('未授权转出事故必须带来源案号与定性行号');
    }
    const disp = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dto.sourceDispositionNo } });
    if (!disp) throw new NotFoundException(`定性行不存在：${dto.sourceDispositionNo}`);
    if (disp.outlet !== 'INCIDENT' || disp.causeCode !== 'UNAUTHORIZED_OUTFLOW') {
      throw new BadRequestException(`定性行 ${dto.sourceDispositionNo} 不是未授权转出定性（outlet=${disp.outlet}/causeCode=${disp.causeCode}），不能登记这一类事故`);
    }
    if (disp.incidentNo) {
      throw new BadRequestException(`定性行 ${dto.sourceDispositionNo} 已挂事故 ${disp.incidentNo}，不能一行两事故`);
    }
  }

  private async assertLargeUnexplained(dto: RegisterIncidentDto): Promise<void> {
    if (!dto.sourceCaseNo) throw new BadRequestException('大额查不出事故必须带来源案号');
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.sourceCaseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${dto.sourceCaseNo}`);
    if (!kase.slaBreached) throw new BadRequestException(`案子 ${dto.sourceCaseNo} 还没到账龄线，够不上升级事故`);
  }

  private async assertClientShortfall(dto: RegisterIncidentDto): Promise<void> {
    if (!dto.customerNo || !dto.amount) throw new BadRequestException('退汇欠款事故必须带客户号与金额');
    if (dto.sourceAdvanceTransferNo) {
      const transfer = await (this.prisma as any).internalTransfer.findUnique({ where: { transferNo: dto.sourceAdvanceTransferNo } });
      if (!transfer) throw new NotFoundException(`垫款单不存在：${dto.sourceAdvanceTransferNo}`);
      if (transfer.purpose !== 'CLIENT_ADVANCE') throw new BadRequestException(`划转单 ${dto.sourceAdvanceTransferNo} 不是垫款单（purpose=${transfer.purpose}），不能锚定欠款事故`);
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
    if (!body) throw new BadRequestException('调查记录必须填写内容');
    const row = await this.findByNo(incidentNo);
    await (this.prisma as any).incidentNote.create({
      data: { incidentId: row.id, kind: 'NOTE', body, authorUserId: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.INCIDENT_NOTE_ADDED, actor, { reason: body, extra: { body } });
    return { incidentNo };
  }

  async escalate(incidentNo: string, dto: EscalateIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    if (!dto.to) throw new BadRequestException('升级必须指定去向');
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
    if (!reason) throw new BadRequestException('撤回必须填写理由');
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
    if (!dto.assessedAmount || !dto.assessmentBasis) throw new BadRequestException('定损必须带定损金额与结论');
    const basisCodes = dto.reportRequired ? (dto.reportBasisCodes ?? []) : [];
    if (dto.reportRequired) {
      if (!basisCodes.length) throw new BadRequestException('判定需要通报必须带依据码');
      for (const code of basisCodes) {
        if (!(code in INCIDENT_REPORT_BASES)) throw new BadRequestException(`未知依据码：${code}`);
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
        reason: '起草监管通报稿',
      });
    }
    return { incidentNo };
  }

  /** 标已通报：前置 reportRequired && reportDraft 非空；落 reportedAt/reportedByUserId，软标不推状态。 */
  async markReported(incidentNo: string, dto: MarkReportedDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    const row = await this.findByNo(incidentNo);
    if (!row.reportRequired || !row.reportDraft) {
      throw new BadRequestException('必须已判定需要通报且已起草通报稿才能标记已通报');
    }
    const updated = await (this.prisma as any).incident.update({
      where: { incidentNo },
      data: { reportedAt: new Date(), reportedByUserId: actor.userNo ?? actor.userId, reportReference: dto.reference ?? null },
    });
    // requiredFields=['basisCodes']（spec §7 硬性要求）——值是落库同款逗号分隔字符串，非数组。
    await this.recordAudit(updated, AuditActions.INCIDENT_REGULATOR_REPORTED, actor, {
      reason: '完成监管通报', extra: { basisCodes: row.reportBasisCodes },
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
      throw new BadRequestException(`事故还没定损，善后单挂不上——先定损（当前状态：${row.status}）`);
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
    await this.recordAudit(updated, AuditActions.INCIDENT_REMEDIATION_LINKED, actor, {
      reason: `挂载善后单 ${dto.referenceNo}（${dto.kind}）`, extra: { referenceNo: dto.referenceNo },
      metadata: { kind: dto.kind, referenceNo: dto.referenceNo, ...(statusAdvanced ? { statusAdvanced } : {}) },
    });
    return { incidentNo };
  }

  private async assertRemediationReferenceExists(kind: string, referenceNo: string): Promise<void> {
    switch (kind) {
      case IncidentRemediationKinds.ADJUSTMENT: {
        const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo: referenceNo } });
        if (!row) throw new NotFoundException(`调账单不存在：${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.TRANSFER: {
        const row = await (this.prisma as any).internalTransfer.findUnique({ where: { transferNo: referenceNo } });
        if (!row) throw new NotFoundException(`内部划转单不存在：${referenceNo}`);
        return;
      }
      case IncidentRemediationKinds.SUPPLEMENT:
      case IncidentRemediationKinds.CLAIM: {
        // 补录 / 退汇认领落地后都是一张充值单（depositNo）——B 批 disposition.supplementNo 回填的即此号。
        const row = await (this.prisma as any).depositTransaction.findUnique({ where: { depositNo: referenceNo } });
        if (!row) throw new NotFoundException(`充值单不存在：${referenceNo}`);
        return;
      }
      default:
        throw new BadRequestException(`未知善后类型：${kind}`);
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
