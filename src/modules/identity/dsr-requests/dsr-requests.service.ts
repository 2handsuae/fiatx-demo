// 战役丙波四 T5 · DSR（资料请求）主体服务（spec §3）。
// 铁律③各管各的：本服务只写自己的表（data_subject_requests）；摘要/条款引用对客户主数据、协议同意台账、
//   材料请求只读（横向读客户主数据放行）。REVERIFY 的连带开材料单是跨主体协作，T8 在本服务 resolve 里
//   调既有 MaterialRequestIssuerService（只调主体服务方法）——本任务只留 materialRequestNo 的空写入位。
// 铁律④状态只能沿边走：DSR_STATUS_TRANSITIONS 显式迁移表，非法跃迁 400 带码 INVALID_TRANSITION。
// 铁律①操作必留痕：五个写方法各一条审计，全部 recordByActor（提交=客户，其余=管理台操作者）；
//   requestId 每次显式带——审计 idempotencyKey 含 requestId，缺了会按 NO_REQUEST_ID 静默去重。
// 铁律⑥对外用业务键：投影零 id/customerId，客户用 customerNo、单据用 requestNo。
// tipping-off 红线（decisions:65）：摘要只装 DSR_SUMMARY_PROFILE_FIELDS 白名单字段；
//   riskRating / eddRequired / hardLineDispositionedAt / 限制 / 标签一律不入。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSubjectRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import {
  DSR_CLAUSE_SECTION, DSR_DUE_DAYS, DSR_RESOLUTION_BY_TYPE, DSR_STATUS_TRANSITIONS, DSR_SUMMARY_PROFILE_FIELDS,
  DsrClauseRef, DsrResolutionCode, DsrResolutionCodeValue, DsrStatus, DsrStatusValue, DsrSummarySnapshot, DsrType, DsrTypeValue,
} from './dsr.constants';

/** 两种 actor：客户（submit）/ 管理台（其余四个写方法）。只在本文件内选 recordByActor 的 actorType 分支。 */
type DsrActor = { kind: 'CUSTOMER'; customerNo: string } | { kind: 'ADMIN'; ctx: ApprovalActorContext };

export interface DsrListItem {
  requestNo: string;
  customerNo: string;
  type: string;
  status: string;
  submittedAt: string;
  reviewStartedAt: string | null;
  resolvedAt: string | null;
  dueAt: string;
  resolutionCode: string | null;
}

export interface DsrAdminView extends DsrListItem {
  detail: string;
  resolutionNote: string | null;
  clauseRef: DsrClauseRef | null;
  summary: DsrSummarySnapshot | null;
  materialRequestNo: string | null;
}

/** 客户面显式投影：dueAt 是内部办理时限不下发；materialRequestNo/customerNo 也不下发。 */
export interface ClientDsrRow {
  requestNo: string;
  type: DsrTypeValue;
  detail: string;
  status: DsrStatusValue;
  submittedAt: string;
  resolvedAt: string | null;
  resolutionCode: DsrResolutionCodeValue | null;
  resolutionNote: string | null;
  clauseRef: DsrClauseRef | null;
  summary: DsrSummarySnapshot | null;
}

export interface DsrListFilter {
  type?: string;
  status?: string;
  overdue?: boolean;
}

@Injectable()
export class DsrRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(requestNo: string): Promise<DataSubjectRequest> {
    const row = await this.prisma.dataSubjectRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Data request not found: ${requestNo}`);
    return row;
  }

  private parseJson<T>(raw: string | null): T | null {
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private async customerNoOf(customerId: string): Promise<string> {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId }, select: { customerNo: true } });
    if (!c) throw new NotFoundException('Customer not found');
    return c.customerNo;
  }

  private toListItem(row: DataSubjectRequest, customerNo: string): DsrListItem {
    return {
      requestNo: row.requestNo,
      customerNo,
      type: row.type,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      reviewStartedAt: row.reviewStartedAt ? row.reviewStartedAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      dueAt: row.dueAt.toISOString(),
      resolutionCode: row.resolutionCode ?? null,
    };
  }

  async listAdmin(filter: DsrListFilter = {}): Promise<DsrListItem[]> {
    const where: Prisma.DataSubjectRequestWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.status) where.status = filter.status;
    if (filter.overdue) where.dueAt = { lt: new Date() };
    const rows = await this.prisma.dataSubjectRequest.findMany({ where, orderBy: { submittedAt: 'desc' } });
    // 逾期 = 未办结且 dueAt 已过（读时现算，同投诉）；办结单即便 dueAt 在过去也不算逾期。
    const live = filter.overdue ? rows.filter((r) => r.status !== DsrStatus.RESOLVED) : rows;
    const customers = await this.prisma.customerMain.findMany({
      where: { id: { in: [...new Set(live.map((r) => r.customerId))] } },
      select: { id: true, customerNo: true },
    });
    const noById = new Map(customers.map((c) => [c.id, c.customerNo]));
    return live.map((r) => this.toListItem(r, noById.get(r.customerId) ?? ''));
  }

  async detailAdmin(requestNo: string): Promise<DsrAdminView> {
    const row = await this.findByNo(requestNo);
    const customerNo = await this.customerNoOf(row.customerId);
    return {
      ...this.toListItem(row, customerNo),
      detail: row.detail,
      resolutionNote: row.resolutionNote ?? null,
      clauseRef: this.parseJson<DsrClauseRef>(row.clauseRef),
      summary: this.parseJson<DsrSummarySnapshot>(row.summary),
      materialRequestNo: row.materialRequestNo ?? null,
    };
  }

  /** 客户面唯一出口：显式字段投影，不下发 dueAt/materialRequestNo/customerNo/任何 id。 */
  private toClientRow(r: DataSubjectRequest): ClientDsrRow {
    return {
      requestNo: r.requestNo,
      type: r.type as DsrTypeValue,
      detail: r.detail,
      status: r.status as DsrStatusValue,
      submittedAt: r.submittedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionCode: (r.resolutionCode ?? null) as DsrResolutionCodeValue | null,
      resolutionNote: r.resolutionNote ?? null,
      clauseRef: this.parseJson<DsrClauseRef>(r.clauseRef),
      summary: this.parseJson<DsrSummarySnapshot>(r.summary),
    };
  }

  /** 客户面：只列自己的（customerId = JWT sub）。 */
  async listForCustomer(customerId: string): Promise<ClientDsrRow[]> {
    const rows = await this.prisma.dataSubjectRequest.findMany({ where: { customerId }, orderBy: { submittedAt: 'desc' } });
    return rows.map((r) => this.toClientRow(r));
  }

  /** 客户面详情：别人的号与不存在的号统一查无（同一句 404，不确认号是否真实存在）。 */
  async getForCustomer(customerId: string, requestNo: string): Promise<ClientDsrRow> {
    const row = await this.prisma.dataSubjectRequest.findUnique({ where: { requestNo } });
    if (!row || row.customerId !== customerId) throw new NotFoundException('Data request not found');
    return this.toClientRow(row);
  }

  // ── 迁移守卫（铁律④）──────────────────────────────────────────────

  private assertTransition(from: string, to: string): void {
    const allowed = DSR_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException({ code: 'INVALID_TRANSITION', message: `Invalid data request transition ${from} → ${to}` });
    }
  }

  private async transition(row: DataSubjectRequest, to: string, patch: Record<string, unknown> = {}): Promise<DataSubjectRequest> {
    this.assertTransition(row.status, to);
    return this.prisma.dataSubjectRequest.update({ where: { requestNo: row.requestNo }, data: { status: to, ...patch } });
  }

  // ── 提交（客户）：dueAt = submittedAt + 30 自然日，提交时一次算定 ──────────────

  async submit(customer: { id: string }, dto: { type: string; detail: string }): Promise<{ requestNo: string }> {
    const customerNo = await this.customerNoOf(customer.id);
    const submittedAt = new Date();
    const dueAt = new Date(submittedAt.getTime() + DSR_DUE_DAYS * 86400000);
    const row = await this.prisma.dataSubjectRequest.create({
      data: {
        requestNo: generateReferenceNo('DSR'),
        customerId: customer.id,
        type: dto.type,
        detail: dto.detail,
        status: DsrStatus.SUBMITTED,
        submittedAt, dueAt,
      },
    });
    await this.recordAudit(row, customerNo, AuditActions.DSR_SUBMITTED, { kind: 'CUSTOMER', customerNo }, {
      requestId: row.requestNo,
      extra: { type: row.type },
      metadata: { type: row.type, dueAt: dueAt.toISOString() },
    });
    return { requestNo: row.requestNo };
  }

  // ── 受理（SUBMITTED→IN_REVIEW）──────────────────────────────────────

  async startReview(actor: ApprovalActorContext, requestNo: string): Promise<{ requestNo: string }> {
    const row = await this.findByNo(requestNo);
    const customerNo = await this.customerNoOf(row.customerId);
    const updated = await this.transition(row, DsrStatus.IN_REVIEW, { reviewStartedAt: new Date() });
    await this.recordAudit(updated, customerNo, AuditActions.DSR_REVIEW_STARTED, { kind: 'ADMIN', ctx: actor }, {
      requestId: requestNo,
      fromStatus: row.status, toStatus: updated.status,
    });
    return { requestNo };
  }

  // ── 生成资料摘要（仅 ACCESS、仅 IN_REVIEW、只写一次）──────────────────────

  async generateSummary(actor: ApprovalActorContext, requestNo: string): Promise<{ requestNo: string }> {
    const row = await this.findByNo(requestNo);
    if (row.type !== DsrType.ACCESS) {
      throw new BadRequestException(`Data request ${requestNo} is ${row.type}; a summary can only be generated for an ACCESS request`);
    }
    if (row.status !== DsrStatus.IN_REVIEW) {
      throw new BadRequestException(`Data request ${requestNo} must be IN_REVIEW to generate a summary (current status: ${row.status})`);
    }
    if (row.summary) {
      throw new BadRequestException(`Data request ${requestNo} already has a summary; it is written once`);
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: row.customerId },
      select: Object.fromEntries(DSR_SUMMARY_PROFILE_FIELDS.map((f) => [f, true])) as Record<string, true>,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    // 白名单显式挑字段：即便查询多吐了列，这里也只取枚举内的键（tipping-off 红线）。
    const profile = Object.fromEntries(DSR_SUMMARY_PROFILE_FIELDS.map((f) => {
      const v = (customer as Record<string, unknown>)[f];
      return [f, v instanceof Date ? v.toISOString() : (v ?? null)];
    })) as DsrSummarySnapshot['profile'];

    const consents = await this.prisma.customerAgreementConsent.findMany({
      where: { customerId: row.customerId }, orderBy: { actedAt: 'asc' },
    });
    const materials = await this.prisma.materialRequest.findMany({
      where: { customerId: row.customerId }, orderBy: { issuedAt: 'asc' },
    });

    const snapshot: DsrSummarySnapshot = {
      generatedAt: new Date().toISOString(),
      profile,
      agreementConsents: consents.map((c) => ({ versionKey: c.versionKey, actedAt: c.actedAt.toISOString(), decision: c.action })),
      kycMaterials: materials.map((m) => ({ materialType: m.materialType, status: m.status, issuedAt: m.issuedAt.toISOString() })),
    };

    const customerNo = profile.customerNo as string;
    await this.prisma.dataSubjectRequest.update({ where: { requestNo }, data: { summary: JSON.stringify(snapshot) } });
    await this.recordAudit(row, customerNo, AuditActions.DSR_SUMMARY_GENERATED, { kind: 'ADMIN', ctx: actor }, {
      requestId: requestNo,
    });
    return { requestNo };
  }

  // ── 办结（IN_REVIEW→RESOLVED；resolutionCode×type 匹配；终态后一切写 400）────────

  async resolve(
    actor: ApprovalActorContext,
    requestNo: string,
    dto: { resolutionCode: string; resolutionNote: string },
  ): Promise<{ requestNo: string }> {
    const row = await this.findByNo(requestNo);
    this.assertTransition(row.status, DsrStatus.RESOLVED);
    if (!(DSR_RESOLUTION_BY_TYPE[row.type] ?? []).includes(dto.resolutionCode)) {
      throw new BadRequestException(`Resolution ${dto.resolutionCode} is not valid for a ${row.type} request`);
    }
    if (row.type === DsrType.ACCESS && !row.summary) {
      throw new BadRequestException(`Data request ${requestNo} needs its summary generated before it can be resolved`);
    }
    const customerNo = await this.customerNoOf(row.customerId);

    // ERASURE 的拒绝信必须引条款：自动取该客户最新「同意」的协议版本 + §VI（DECLINED 行不算同意）。
    let clauseRef: string | null = null;
    if (dto.resolutionCode === DsrResolutionCode.ERASURE_REFUSED_RETENTION) {
      const latest = await this.prisma.customerAgreementConsent.findFirst({
        where: { customerId: row.customerId, action: 'ACCEPTED' }, orderBy: { actedAt: 'desc' },
      });
      if (!latest) {
        throw new BadRequestException(`Customer has no accepted agreement version on record, so there is no clause to cite for ${requestNo}`);
      }
      clauseRef = JSON.stringify({ versionKey: latest.versionKey, section: DSR_CLAUSE_SECTION } satisfies DsrClauseRef);
    }

    // T8 接管：RECTIFICATION_REVERIFY 在此先开材料单取号；本任务恒为 null（resolve 不因缺它失败）。
    const materialRequestNo: string | null = null;

    const updated = await this.transition(row, DsrStatus.RESOLVED, {
      resolvedAt: new Date(),
      resolutionCode: dto.resolutionCode,
      resolutionNote: dto.resolutionNote,
      clauseRef,
      materialRequestNo,
    });
    await this.recordAudit(updated, customerNo, AuditActions.DSR_RESOLVED, { kind: 'ADMIN', ctx: actor }, {
      requestId: requestNo,
      fromStatus: row.status, toStatus: updated.status,
      extra: { resolutionCode: dto.resolutionCode },
      metadata: { type: row.type, resolutionCode: dto.resolutionCode },
    });

    // 持久物先于信号：落库+审计之后才通知；通知是旁路副作用，抛错不回滚、不拖垮办结。
    try {
      await this.notificationsService.notifyDsrResolved({ customerId: row.customerId, requestNo });
    } catch (err) {
      console.error(`[DsrRequestsService] notifyDsrResolved failed for ${requestNo}:`, err);
    }
    return { requestNo };
  }

  // ── ⚡ 演示装置：dueAt → now−1h；终态 400（照 complaints.simulateTimeout 逐行同款）──

  async simulateTimeout(actor: ApprovalActorContext, requestNo: string): Promise<{ requestNo: string }> {
    const row = await this.findByNo(requestNo);
    if (row.status === DsrStatus.RESOLVED) {
      throw new BadRequestException(`Data request ${requestNo} is in a terminal state (${row.status}) and its deadline cannot be fast-forwarded`);
    }
    const customerNo = await this.customerNoOf(row.customerId);
    const dueAt = new Date(Date.now() - 3600 * 1000);
    const updated = await this.prisma.dataSubjectRequest.update({ where: { requestNo }, data: { dueAt } });
    await this.recordAudit(updated, customerNo, AuditActions.DSR_DEADLINE_FASTFORWARDED, { kind: 'ADMIN', ctx: actor }, {
      // ⚡可对同一单重拨：requestId 带随机后缀，免得第二次被同一把 idempotencyKey 静默吞掉（铁律①每次动作都留痕）。
      requestId: `${requestNo}_${randomUUID()}`,
      metadata: { dueAt: dueAt.toISOString() },
    });
    return { requestNo };
  }

  // ── 审计（五码共用信封：primarySubject 恒为 DSR_REQUEST/requestNo，OWNER 恒为该客户；
  //     全走 recordByActor，requestId 由调用方显式给）──────────────────────────

  private async recordAudit(
    row: DataSubjectRequest, customerNo: string, action: string, actor: DsrActor,
    patch: {
      requestId: string; fromStatus?: string; toStatus?: string;
      metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    const input: any = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.DSR_REQUEST, primarySubjectNo: row.requestNo,
      ownerCustomerNo: customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.DSR_REQUEST, subjectNo: row.requestNo, subjectRole: AuditSubjectRole.PRIMARY },
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: AuditSubjectRole.OWNER },
      ],
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      requestId: patch.requestId,
      // requiredFields 顶层展开（assertActionSpec 只查 input 顶层）+ metadata 镜像（审计页展示读它）。
      requestNo: row.requestNo,
      metadata: { requestNo: row.requestNo, ...(patch.metadata ?? {}) },
      ...(patch.extra ?? {}),
    };
    if (actor.kind === 'CUSTOMER') {
      await this.auditLogs.recordByActor({ ...input, sourcePlatform: 'CLIENT_API' }, {
        actorType: 'CUSTOMER', actorNo: actor.customerNo, actorDisplayName: actor.customerNo, actorRolesAtTime: ['CUSTOMER'],
      });
      return;
    }
    const display = actor.ctx.userNo ?? actor.ctx.userId;
    await this.auditLogs.recordByActor({ ...input, sourcePlatform: 'ADMIN' }, {
      actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.ctx.roleCodes ?? [],
    });
  }
}
