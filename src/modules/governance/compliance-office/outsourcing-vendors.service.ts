// 战役甲波四 · 合规办公室骨架（Task 4）：外包供应商登记册 OutsourcingVendor。
// 铁律③：本服务只写自己的一张表（outsourcing_vendors）。
// 模板：recordAudit 私有 helper 形状、Prisma 用法、generateReferenceNo 导入照
// compliance-obligations.service.ts 先例（同目录 Task 2）——没有 claimDue 那类系统钟，
// 本主体不计时（本任务过清单：VENDOR 两态无钟）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OutsourcingVendor } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { VENDOR_TRANSITIONS, VendorStatus } from './compliance-office.constants';

/** criticality 是 spec 定死的封闭两值——不建枚举类型是照 ComplianceObligation 的 frequency
 *  先例（顶层常量文件只放显式迁移表，字符串枚举值不单独抽类型）。 */
export interface CreateVendorDto {
  name: string;
  serviceDescription: string;
  criticality: 'MATERIAL' | 'NON_MATERIAL';
  contractStart: string;
  contractEnd?: string;
  notes?: string;
}

/** update 只改描述性字段——status 只走 terminate（各管各的，同 UpdateObligationDto 先例）。 */
export interface UpdateVendorDto {
  name?: string;
  serviceDescription?: string;
  criticality?: 'MATERIAL' | 'NON_MATERIAL';
  contractStart?: string;
  contractEnd?: string;
  notes?: string;
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

  /** 战役甲波四 T5：列表/详情投影——铁律⑥零 id（controller GET 两端点消费，T4 未建，
   *  本任务按需补）。 */
  async list() {
    const rows = await this.prisma.outsourcingVendor.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toListItem(r));
  }

  async getView(vendorNo: string) {
    const row = await this.findByNo(vendorNo);
    return this.toListItem(row);
  }

  private toListItem(row: OutsourcingVendor) {
    return {
      vendorNo: row.vendorNo, name: row.name, serviceDescription: row.serviceDescription,
      criticality: row.criticality,
      contractStart: row.contractStart.toISOString(),
      contractEnd: row.contractEnd ? row.contractEnd.toISOString() : null,
      status: row.status, notes: row.notes ?? null,
      createdByUserId: row.createdByUserId, createdAt: row.createdAt.toISOString(),
    };
  }

  // ── 建档 ────────────────────────────────────────────────────────────

  async register(actor: ApprovalActorContext, dto: CreateVendorDto): Promise<{ vendorNo: string }> {
    const traceId = randomUUID();
    const row = await this.prisma.outsourcingVendor.create({
      data: {
        vendorNo: generateReferenceNo('VEN'),
        name: dto.name,
        serviceDescription: dto.serviceDescription,
        criticality: dto.criticality,
        contractStart: new Date(dto.contractStart),
        contractEnd: dto.contractEnd ? new Date(dto.contractEnd) : null,
        notes: dto.notes ?? null,
        status: VendorStatus.ACTIVE,
        createdByUserId: actor.userNo ?? actor.userId,
        traceId,
      },
    });
    await this.recordAudit(row, AuditActions.VENDOR_REGISTERED, actor, {
      // R5 修订：criticality 镜像进 metadata——登记时刻的关键性快照查审计行本身就能看到。
      extra: { criticality: row.criticality },
      metadata: { name: row.name, criticality: row.criticality },
    });
    return { vendorNo: row.vendorNo };
  }

  // ── 改描述性字段（不动 status——各管各的） ──────────────────────────

  async update(vendorNo: string, actor: ApprovalActorContext, dto: UpdateVendorDto): Promise<{ vendorNo: string }> {
    const row = await this.findByNo(vendorNo);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.serviceDescription !== undefined) data.serviceDescription = dto.serviceDescription;
    if (dto.criticality !== undefined) data.criticality = dto.criticality;
    if (dto.contractStart !== undefined) data.contractStart = new Date(dto.contractStart);
    if (dto.contractEnd !== undefined) data.contractEnd = dto.contractEnd ? new Date(dto.contractEnd) : null;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const updated = await this.prisma.outsourcingVendor.update({ where: { vendorNo: row.vendorNo }, data });
    await this.recordAudit(updated, AuditActions.VENDOR_UPDATED, actor, {});
    return { vendorNo };
  }

  // ── 终止（铁律④显式迁移表：ACTIVE→TERMINATED 唯一边，终态零出边，无硬删） ────

  async terminate(vendorNo: string, actor: ApprovalActorContext, dto: { notes?: string } = {}): Promise<{ vendorNo: string }> {
    const row = await this.findByNo(vendorNo);
    const allowed = VENDOR_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(VendorStatus.TERMINATED)) {
      throw new BadRequestException(`Invalid vendor transition ${row.status} → ${VendorStatus.TERMINATED}`);
    }
    const data: Record<string, unknown> = { status: VendorStatus.TERMINATED };
    if (dto.notes !== undefined) data.notes = dto.notes;
    const updated = await this.prisma.outsourcingVendor.update({ where: { vendorNo: row.vendorNo }, data });
    await this.recordAudit(updated, AuditActions.VENDOR_TERMINATED, actor, {
      fromStatus: row.status, toStatus: VendorStatus.TERMINATED,
    });
    return { vendorNo };
  }

  // ── 审计（三码共用信封；primarySubject 恒为 OUTSOURCING_VENDOR/vendorNo，
  //     correlationId 恒继承 row.traceId——VENDOR_REGISTERED 铸的旅程）────────────

  private async recordAudit(row: OutsourcingVendor, action: string, actor: ApprovalActorContext, patch: {
    fromStatus?: string; toStatus?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.OUTSOURCING_VENDOR, subjectNo: row.vendorNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.OUTSOURCING_VENDOR,
      primarySubjectType: AuditEntityTypes.OUTSOURCING_VENDOR, primarySubjectNo: row.vendorNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      correlationId: row.traceId,
      // 每次写入显式带 requestId——同 obligations 先例：不传会撞同一把 idempotencyKey
      // 被静默去重（同一 (domain, action, subject, correlationId) 组合的第二次 update 调用）。
      requestId: `${action}_${row.vendorNo}_${randomUUID()}`,
      metadata: { vendorNo: row.vendorNo, ...(patch.metadata ?? {}) },
      sourcePlatform: 'ADMIN',
      ...(patch.extra ?? {}),
    };
    const display = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
  }
}
