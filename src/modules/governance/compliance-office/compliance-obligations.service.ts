// 战役甲波四 · 合规办公室骨架（spec §3.2，Task 2）：主体 ComplianceObligation 的核心服务。
// 铁律③：本服务只写自己的一张表（compliance_obligations）。
// 模板：recordAudit 私有 helper 形状、Prisma 用法、generateReferenceNo 导入照
// regulatory-filing.service.ts 先例；claimDue 是系统动作（供 T3 sweep 调用，本任务不建
// workflow/controller），走 recordSystem，无 actor。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceObligation } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  CreateObligationDto, ObligationFrequency, OBLIGATION_TRANSITIONS, ObligationStatus,
  UpdateObligationDto, advanceDueDate,
} from './compliance-office.constants';

@Injectable()
export class ComplianceObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(obligationNo: string): Promise<ComplianceObligation> {
    const row = await this.prisma.complianceObligation.findUnique({ where: { obligationNo } });
    if (!row) throw new NotFoundException(`Compliance obligation not found: ${obligationNo}`);
    return row;
  }

  // ── 建档（spec §3.2：义务登记铸旅程） ─────────────────────────────

  async create(actor: ApprovalActorContext, dto: CreateObligationDto): Promise<{ obligationNo: string }> {
    const traceId = randomUUID();
    const row = await this.prisma.complianceObligation.create({
      data: {
        obligationNo: generateReferenceNo('OBL'),
        name: dto.name,
        description: dto.description ?? null,
        frequency: dto.frequency,
        authority: dto.authority,
        basisNote: dto.basisNote,
        leadBusinessDays: dto.leadBusinessDays ?? 5,
        nextDueAt: new Date(dto.nextDueAt),
        status: ObligationStatus.ACTIVE,
        createdByUserId: actor.userNo ?? actor.userId,
        traceId,
      },
    });
    await this.recordAudit(row, AuditActions.OBLIGATION_REGISTERED, actor, {
      extra: { frequency: row.frequency },
      metadata: { name: row.name, authority: row.authority },
    });
    return { obligationNo: row.obligationNo };
  }

  // ── 改描述性字段（不动 status/nextDueAt——各管各的，见 constants 头注释） ────

  async update(obligationNo: string, actor: ApprovalActorContext, dto: UpdateObligationDto): Promise<{ obligationNo: string }> {
    const row = await this.findByNo(obligationNo);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.authority !== undefined) data.authority = dto.authority;
    if (dto.basisNote !== undefined) data.basisNote = dto.basisNote;
    if (dto.leadBusinessDays !== undefined) data.leadBusinessDays = dto.leadBusinessDays;
    const updated = await this.prisma.complianceObligation.update({ where: { obligationNo: row.obligationNo }, data });
    await this.recordAudit(updated, AuditActions.OBLIGATION_UPDATED, actor, {});
    return { obligationNo };
  }

  // ── 状态迁移（铁律④显式迁移表：ACTIVE ↔ DISABLED，非法跃迁含同态自转一律 400） ──

  async setStatus(obligationNo: string, actor: ApprovalActorContext, to: string): Promise<{ obligationNo: string }> {
    const row = await this.findByNo(obligationNo);
    const allowed = OBLIGATION_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Invalid obligation transition ${row.status} → ${to}`);
    }
    const updated = await this.prisma.complianceObligation.update({ where: { obligationNo: row.obligationNo }, data: { status: to } });
    await this.recordAudit(updated, AuditActions.OBLIGATION_STATUS_CHANGED, actor, {
      fromStatus: row.status, toStatus: to,
    });
    return { obligationNo };
  }

  // ── 到期认领 + 翻期（系统动作，供 T3 sweep 调用；本任务不开单，不建 workflow） ───

  /** 读行 → dueAt=当前 nextDueAt（翻期前，供调用方开单）→ nextDueAt=advanceDueDate(dueAt,
   *  frequency) 落库 → 审计 OBLIGATION_FILING_GENERATED（携旧 dueAt + 固定 filingType）→
   *  返回旧 dueAt。翻期在生成时完成，一期一单由本方法的构造保证（同一 dueAt 只可能被
   *  claimDue 消费一次——消费的同时它已不再是 nextDueAt）。
   *  `now` 由调用方（T3 sweep）显式传入，作为本次认领的逻辑发生时刻写入审计
   *  occurredAt——sweep 的资格判断（`addBusinessDays(now, leadBusinessDays) >= nextDueAt`）
   *  已经在调用前做过，本方法不重复校验，只如实记录"认领发生在 now"。 */
  async claimDue(obligationNo: string, now: Date): Promise<{ dueAt: Date; obligation: ComplianceObligation }> {
    const row = await this.findByNo(obligationNo);
    const dueAt = row.nextDueAt;
    const nextDueAt = advanceDueDate(dueAt, row.frequency as ObligationFrequency);
    const updated = await this.prisma.complianceObligation.update({ where: { obligationNo: row.obligationNo }, data: { nextDueAt } });
    await this.recordAudit(updated, AuditActions.OBLIGATION_FILING_GENERATED, null, {
      occurredAt: now.toISOString(),
      extra: { dueAt: dueAt.toISOString(), filingType: 'PERIODIC_RETURN' },
      metadata: { nextDueAt: nextDueAt.toISOString() },
    });
    return { dueAt, obligation: updated };
  }

  /** 回填开单后的单号展示字段——不重记审计（OBLIGATION_FILING_GENERATED 已经在
   *  claimDue 那次写入记过了，这里只是把 lastFilingNo 这一展示列补上）。 */
  async recordGenerated(obligationNo: string, filingNo: string): Promise<void> {
    await this.prisma.complianceObligation.update({ where: { obligationNo }, data: { lastFilingNo: filingNo } });
  }

  // ── ⚡ 演示装置（挂路由在 T5）──────────────────────────────────────

  /** 把 nextDueAt 拨到 now，供演示者立刻触发下一次 sweep 命中而不必真等一个月/一季度。 */
  async simulateDue(actor: ApprovalActorContext, obligationNo: string): Promise<{ obligationNo: string }> {
    const row = await this.findByNo(obligationNo);
    const now = new Date();
    const updated = await this.prisma.complianceObligation.update({ where: { obligationNo: row.obligationNo }, data: { nextDueAt: now } });
    await this.recordAudit(updated, AuditActions.OBLIGATION_DUE_FASTFORWARDED, actor, {
      extra: { nextDueAt: now.toISOString() },
    });
    return { obligationNo };
  }

  // ── 审计（五码共用信封；primarySubject 恒为 COMPLIANCE_OBLIGATION/obligationNo，
  //     correlationId 恒继承 row.traceId——OBLIGATION_REGISTERED 铸的旅程）────────────

  private async recordAudit(row: ComplianceObligation, action: string, actor: ApprovalActorContext | null, patch: {
    fromStatus?: string; toStatus?: string;
    /** 系统动作（claimDue）显式传入——sweep 声明的逻辑 now，供确定性断言；其余方法
     *  留空退化到写入时刻（既有先例见 regulatory-filing.service.ts 的 recordAudit）。 */
    occurredAt?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.COMPLIANCE_OBLIGATION, subjectNo: row.obligationNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.COMPLIANCE_OBLIGATION,
      primarySubjectType: AuditEntityTypes.COMPLIANCE_OBLIGATION, primarySubjectNo: row.obligationNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      correlationId: row.traceId,
      occurredAt: patch.occurredAt,
      // 每次写入显式带 requestId（不留 undefined）——本仓判例：requestId 缺失时
      // idempotencyKey 的拼装串落在同一个 'NO_REQUEST_ID' 占位上，同一 (domain, action,
      // subject, correlationId) 组合的第二次写入会撞同一把 idempotencyKey 被静默去重
      // （见 audit-logs.service.ts#buildIdempotencyKey）。本服务多个方法会对同一
      // obligationNo 反复写同一个 action（如多次 update），若都不传 requestId 就会互相
      // 吞掉——每次调用用 randomUUID 铸一个独一份。
      requestId: `${action}_${row.obligationNo}_${randomUUID()}`,
      metadata: { obligationNo: row.obligationNo, ...(patch.metadata ?? {}) },
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
