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
  EscalateIncidentDto, INCIDENT_TRANSITIONS, IncidentRemediationKinds, IncidentStatus,
  IncidentTypes, LinkRemediationDto, RegisterIncidentDto,
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

  // ── 善后挂载（spec §5：只校验单号存在，不管账，不管归属校验之外的东西）────

  async linkRemediation(incidentNo: string, dto: LinkRemediationDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    const row = await this.findByNo(incidentNo);
    await this.assertRemediationReferenceExists(dto.kind, dto.referenceNo);
    await (this.prisma as any).incidentRemediation.create({
      data: { incidentId: row.id, kind: dto.kind, referenceNo: dto.referenceNo, linkedByUserId: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.INCIDENT_REMEDIATION_LINKED, actor, {
      reason: `挂载善后单 ${dto.referenceNo}（${dto.kind}）`, extra: { referenceNo: dto.referenceNo }, metadata: { kind: dto.kind, referenceNo: dto.referenceNo },
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

  // ── 审计（十一码共用信封的当前子集：REGISTERED/INVESTIGATION_STARTED/NOTE_ADDED/
  //     ESCALATED/WITHDRAWN/REMEDIATION_LINKED——ASSESSED 系与 CLOSE 系留给 Task 6/7）──

  private async recordAudit(row: any, action: string, actor: ApprovalActorContext, patch: {
    reason?: string; fromStatus?: string; toStatus?: string; correlationId?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INCIDENT, subjectNo: row.incidentNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (row.customerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER });
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
