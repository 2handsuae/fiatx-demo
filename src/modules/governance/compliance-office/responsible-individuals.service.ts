// 战役甲波四 · 合规办公室骨架（Task 4）：受托责任人登记册 ResponsibleIndividual。
// 铁律③：本服务只写自己的一张表（responsible_individuals）。本主体无状态机变更
// （status 恒 ACTIVE，本任务不建 RI_TRANSITIONS——本任务过清单已写死：两册不计时、
// RI 无状态机变更）。换人走 pendingApprovalNo 这一个标记字段，不是 status 迁移。
//
// 控制器裁定 Ruling R1（覆盖 brief 原 proposeReplacement 单方法签名）：审批单号在审批
// 工单开出之后才存在，故 RI 提案拆两个方法：
//   - assertNoPendingReplacement(riNo)：在途查重，T5 的 workflow 在开审批前调用；
//   - recordProposal(actor, riNo, approvalNo, dto)：落 pendingApprovalNo + 审计
//     RI_REPLACEMENT_PROPOSED，T5 在审批单开出后调用（此时 approvalNo 才存在）。
// recordProposal 内部同样先过 assertNoPendingReplacement——同一处判断只写一次，不是
// T5 单独执着，本服务自身的写入路径也必须守住「一席一在途」这条业务规则（并非并发锁，
// 这是禁做清单里的技术兜底；这里挡的是同一时刻两个提案同时挂起的业务态，不是竞态）。
//
// applyReplacement/clearReplacement 照 brief 原文签名：不带 actor——同 claimDue 先例，
// 这是 T5 的 workflow 在审批裁决后驱动的系统动作，走 recordSystem。
// applyReplacement 携带的 dto 承的是「新任」三个字段——schema 没有为待批提案开设一张
// 暂存列（T1 定的表就这些字段），故新值随 T5 调用当场传入（T5 自己持有开单时的提案
// payload），本服务只负责把它落进 incumbent/effectiveFrom/varaRef 三列并清 pending。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ResponsibleIndividual } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

export interface CreateSeatDto {
  position: string;
  incumbentName: string;
  effectiveFrom: string;
  varaRef?: string;
}

/** T5 在开审批单前后各调一次：先 assertNoPendingReplacement 查重，审批单开出后再带着
 *  approvalNo 调 recordProposal。 */
export interface ProposeReplacementDto {
  newIncumbentName: string;
  effectiveFrom: string;
  reason: string;
  varaRef?: string;
}

/** applyReplacement 落库用——同 ProposeReplacementDto 的内容形状，少了 reason（换人
 *  理由已经在 PROPOSED 那次写过审计，APPLIED 只关心换成了谁）。 */
export interface ApplyReplacementDto {
  newIncumbentName: string;
  effectiveFrom: string;
  varaRef?: string;
}

@Injectable()
export class ResponsibleIndividualsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(riNo: string): Promise<ResponsibleIndividual> {
    const row = await this.prisma.responsibleIndividual.findUnique({ where: { riNo } });
    if (!row) throw new NotFoundException(`Responsible individual not found: ${riNo}`);
    return row;
  }

  // ── 建席位 ──────────────────────────────────────────────────────────

  async createSeat(actor: ApprovalActorContext, dto: CreateSeatDto): Promise<{ riNo: string }> {
    const traceId = randomUUID();
    const row = await this.prisma.responsibleIndividual.create({
      data: {
        riNo: generateReferenceNo('RI'),
        position: dto.position,
        incumbentName: dto.incumbentName,
        effectiveFrom: new Date(dto.effectiveFrom),
        varaRef: dto.varaRef ?? null,
        status: 'ACTIVE',
        pendingApprovalNo: null,
        createdByUserId: actor.userNo ?? actor.userId,
        traceId,
      },
    });
    await this.recordAuditByActor(row, AuditActions.RI_SEAT_REGISTERED, actor, {
      extra: { position: row.position },
      metadata: { incumbentName: row.incumbentName },
    });
    return { riNo: row.riNo };
  }

  // ── 在途查重（T5 的 workflow 在开审批前调用；一席一在途，非空即拒） ──────────

  async assertNoPendingReplacement(riNo: string): Promise<void> {
    const row = await this.findByNo(riNo);
    if (row.pendingApprovalNo) {
      throw new BadRequestException(
        `Responsible individual ${riNo} already has a pending replacement (${row.pendingApprovalNo}).`,
      );
    }
  }

  // ── 提案（T5 开出审批单之后调用，此时 approvalNo 才存在；只落 pendingApprovalNo，
  //     不动 incumbent 三列——换人在 applyReplacement 才真正生效） ──────────────

  async recordProposal(actor: ApprovalActorContext, riNo: string, approvalNo: string, dto: ProposeReplacementDto): Promise<{ riNo: string }> {
    await this.assertNoPendingReplacement(riNo);
    const row = await this.prisma.responsibleIndividual.update({ where: { riNo }, data: { pendingApprovalNo: approvalNo } });
    await this.recordAuditByActor(row, AuditActions.RI_REPLACEMENT_PROPOSED, actor, {
      extra: { approvalNo, reason: dto.reason },
      metadata: { newIncumbentName: dto.newIncumbentName, effectiveFrom: dto.effectiveFrom, varaRef: dto.varaRef ?? null },
    });
    return { riNo };
  }

  // ── 生效（T5 的 workflow 在审批裁决 GRANTED 后调用；系统动作，无 actor——同
  //     claimDue 先例）：换 incumbent/effectiveFrom/varaRef 三字段，清 pending ────

  async applyReplacement(riNo: string, approvalNo: string, dto: ApplyReplacementDto): Promise<{ riNo: string }> {
    const before = await this.findByNo(riNo);
    const fromIncumbent = before.incumbentName;
    const toIncumbent = dto.newIncumbentName;
    const row = await this.prisma.responsibleIndividual.update({
      where: { riNo },
      data: {
        incumbentName: toIncumbent,
        effectiveFrom: new Date(dto.effectiveFrom),
        varaRef: dto.varaRef ?? before.varaRef,
        pendingApprovalNo: null,
      },
    });
    await this.recordAuditSystem(row, AuditActions.RI_REPLACEMENT_APPLIED, {
      extra: { approvalNo, fromIncumbent, toIncumbent },
    });
    return { riNo };
  }

  // ── 驳回/撤回/过期（T5 的 workflow 在审批裁决非 GRANTED 后调用；系统动作，无
  //     actor）：只清 pending，不换人 ─────────────────────────────────────

  async clearReplacement(riNo: string, approvalNo: string, decision: string): Promise<{ riNo: string }> {
    await this.findByNo(riNo);
    const row = await this.prisma.responsibleIndividual.update({ where: { riNo }, data: { pendingApprovalNo: null } });
    await this.recordAuditSystem(row, AuditActions.RI_REPLACEMENT_REJECTED, {
      extra: { approvalNo, decision },
    });
    return { riNo };
  }

  // ── 审计（四码共用信封；primarySubject 恒为 RESPONSIBLE_INDIVIDUAL/riNo，
  //     correlationId 恒继承 row.traceId——RI_SEAT_REGISTERED 铸的旅程）────────────

  private buildAuditInput(row: ResponsibleIndividual, action: string, patch: {
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): any {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.RESPONSIBLE_INDIVIDUAL, subjectNo: row.riNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    return {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.RESPONSIBLE_INDIVIDUAL,
      primarySubjectType: AuditEntityTypes.RESPONSIBLE_INDIVIDUAL, primarySubjectNo: row.riNo,
      subjects,
      correlationId: row.traceId,
      // 每次写入显式带 requestId——同 obligations/vendor 先例：不传会撞同一把
      // idempotencyKey 被静默去重。
      requestId: `${action}_${row.riNo}_${randomUUID()}`,
      metadata: { riNo: row.riNo, ...(patch.metadata ?? {}) },
      ...(patch.extra ?? {}),
    };
  }

  private async recordAuditByActor(row: ResponsibleIndividual, action: string, actor: ApprovalActorContext, patch: {
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const input = { ...this.buildAuditInput(row, action, patch), sourcePlatform: 'ADMIN' };
    const display = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
  }

  private async recordAuditSystem(row: ResponsibleIndividual, action: string, patch: {
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const input = { ...this.buildAuditInput(row, action, patch), sourcePlatform: 'SYSTEM' };
    await this.auditLogs.recordSystem(input);
  }
}
