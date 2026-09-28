// 战役甲波五 T2 · 投诉主体服务（task-2-brief.md）。
// 铁律③各管各的：本服务只写自己的两张表（complaints / complaint_entries）；
// markEscalated 只落 escalatedIncidentNo 这个引用列，不横向读/写 incidents 表——事故落库
// 是 T4 的 ComplaintEscalationWorkflowService 编排（铁律③跨主体协作只在 workflow）。
// 铁律④状态只能沿边走：COMPLAINT_TRANSITIONS 显式迁移表，非法跃迁一律 BadRequestException。
// 铁律①操作必留痕：每个写方法一条审计（人为 recordByActor，系统为 recordSystem），
// requestId 每次显式生成（buildAuditInput 里 randomUUID，不留给 auditLogs 默认兜底——
// 漏了会被同一把 idempotencyKey 静默去重，同 RI/Filing 先例）。
// 审计形状照 regulatory-filing.service.ts；proposeResolution/applyResolution/
// rejectResolution 三步时序照 responsible-individuals.service.ts 的
// recordProposal/applyReplacement/clearReplacement（ri-replacement 先例）：
// proposeResolution 只迁状态 + 记 pendingApprovalNo，不落 outcome/resolutionText 本表——
// 那两个值住 T3 审批单自带的 objectSnapshot 里，applyResolution 才真正落库（batch 审批
// 裁决落地后由 T3 的 workflow 调用，系统动作，无 actor）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Complaint, ComplaintEntry } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  ACK_DEADLINE_DAYS, AcknowledgeComplaintDto, COMPLAINT_INVESTIGATING_STATUSES, COMPLAINT_TERMINAL_STATUSES,
  COMPLAINT_TRANSITIONS, ComplaintClientMessageTypes, ComplaintEntryKinds, ComplaintStatus, EXTENDED_DEADLINE_DAYS,
  ExtendComplaintDto, RESOLVE_DEADLINE_DAYS, ResolutionDto, SubmitComplaintDto,
} from './complaint.constants';

/** 三种 actor：客户（submit）/ 管理台（acknowledge…markEscalated/simulateTimeout）/
 *  系统（applyResolution/rejectResolution，由 T3 workflow 在审批裁决落地后驱动，无 actor）。
 *  只在本文件内部用来选 recordByActor 的 actorType 分支，不对外暴露。 */
type ComplaintActor = { kind: 'CUSTOMER'; customerNo: string } | { kind: 'ADMIN'; ctx: ApprovalActorContext };

export interface ComplaintListItem {
  complaintNo: string;
  ownerCustomerNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  currentStatus: string;
  submittedAt: string;
  ackDeadlineAt: string;
  acknowledgedAt: string | null;
  resolveDeadlineAt: string;
  extendedAt: string | null;
  resolvedAt: string | null;
  escalatedIncidentNo: string | null;
}

export interface ComplaintEntryView {
  kind: string;
  messageType: string | null;
  body: string;
  actorNo: string;
  createdAt: string;
}

export interface ComplaintView extends ComplaintListItem {
  description: string;
  resolutionOutcome: string | null;
  resolutionText: string | null;
  pendingApprovalNo: string | null;
  entries: ComplaintEntryView[];
}

/** 客户面专属投影（评审 Important 2）：去掉 pendingApprovalNo/escalatedIncidentNo——
 *  两者都是管理台内部经办状态（在途审批单号 / 升级去向的事故号），客户不该看到；
 *  entries 额外去掉 actorNo（控制器加裁：客户不需要内部经办身份，管理台面 actorNo
 *  可能落的是 admin userNo、也可能是 'SYSTEM'，两种都不该对客户暴露）。 */
export interface ClientComplaintListItem {
  complaintNo: string;
  ownerCustomerNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  currentStatus: string;
  submittedAt: string;
  ackDeadlineAt: string;
  acknowledgedAt: string | null;
  resolveDeadlineAt: string;
  extendedAt: string | null;
  resolvedAt: string | null;
}

export interface ClientComplaintEntryView {
  kind: string;
  messageType: string | null;
  body: string;
  createdAt: string;
}

export interface ClientComplaintView extends ClientComplaintListItem {
  description: string;
  resolutionOutcome: string | null;
  resolutionText: string | null;
  entries: ClientComplaintEntryView[];
}

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(complaintNo: string): Promise<Complaint> {
    const row = await this.prisma.complaint.findUnique({ where: { complaintNo } });
    if (!row) throw new NotFoundException(`Complaint not found: ${complaintNo}`);
    return row;
  }

  /** 铁律⑥投影，零 id（同 regulatory-filing/incident 先例）。 */
  private toListItem(row: Complaint): ComplaintListItem {
    return {
      complaintNo: row.complaintNo,
      ownerCustomerNo: row.ownerCustomerNo,
      category: row.category,
      relatedOrderNo: row.relatedOrderNo ?? null,
      subject: row.subject,
      currentStatus: row.currentStatus,
      submittedAt: row.submittedAt.toISOString(),
      ackDeadlineAt: row.ackDeadlineAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
      resolveDeadlineAt: row.resolveDeadlineAt.toISOString(),
      extendedAt: row.extendedAt ? row.extendedAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      escalatedIncidentNo: row.escalatedIncidentNo ?? null,
    };
  }

  private toView(row: Complaint, entries: ComplaintEntry[]): ComplaintView {
    return {
      ...this.toListItem(row),
      description: row.description,
      resolutionOutcome: row.resolutionOutcome ?? null,
      resolutionText: row.resolutionText ?? null,
      pendingApprovalNo: row.pendingApprovalNo ?? null,
      entries: entries.map((e) => ({
        kind: e.kind, messageType: e.messageType ?? null, body: e.body,
        actorNo: e.actorNo, createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** 客户面专属投影（评审 Important 2）：从 toListItem 去掉 pendingApprovalNo（本就不在
   *  ComplaintListItem 里）/ escalatedIncidentNo；entries 去掉 actorNo。不复用
   *  toListItem/toView 再事后摘字段——直接照着字段表构造，少一处"漏摘"的可能。 */
  private toClientListItem(row: Complaint): ClientComplaintListItem {
    return {
      complaintNo: row.complaintNo,
      ownerCustomerNo: row.ownerCustomerNo,
      category: row.category,
      relatedOrderNo: row.relatedOrderNo ?? null,
      subject: row.subject,
      currentStatus: row.currentStatus,
      submittedAt: row.submittedAt.toISOString(),
      ackDeadlineAt: row.ackDeadlineAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
      resolveDeadlineAt: row.resolveDeadlineAt.toISOString(),
      extendedAt: row.extendedAt ? row.extendedAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }

  private toClientView(row: Complaint, entries: ComplaintEntry[]): ClientComplaintView {
    return {
      ...this.toClientListItem(row),
      description: row.description,
      resolutionOutcome: row.resolutionOutcome ?? null,
      resolutionText: row.resolutionText ?? null,
      entries: entries.map((e) => ({
        kind: e.kind, messageType: e.messageType ?? null, body: e.body, createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** 客户面：只看自己的号。别人的号 / 不存在的号统一「查无」（NotFoundException），
   *  不回 403——照 material-requests 惯例，403 反而会向客户确认「这个号真实存在」。
   *  entries 仅 CLIENT_MESSAGE（INTERNAL_NOTE 不对客户开放）；投影走 toClientView，
   *  不含 pendingApprovalNo/escalatedIncidentNo/entries.actorNo（评审 Important 2）。 */
  async getForCustomer(customerNo: string, complaintNo: string): Promise<ClientComplaintView> {
    const row = await this.prisma.complaint.findUnique({ where: { complaintNo } });
    if (!row || row.ownerCustomerNo !== customerNo) {
      throw new NotFoundException(`Complaint not found: ${complaintNo}`);
    }
    const entries = await this.prisma.complaintEntry.findMany({
      where: { complaintNo, kind: ComplaintEntryKinds.CLIENT_MESSAGE },
      orderBy: { createdAt: 'asc' },
    });
    return this.toClientView(row, entries);
  }

  async listForCustomer(customerNo: string): Promise<ClientComplaintListItem[]> {
    const rows = await this.prisma.complaint.findMany({ where: { ownerCustomerNo: customerNo }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toClientListItem(r));
  }

  /** 管理台面：entries 全量（含 INTERNAL_NOTE）。 */
  async getAdmin(complaintNo: string): Promise<ComplaintView> {
    const row = await this.findByNo(complaintNo);
    const entries = await this.prisma.complaintEntry.findMany({ where: { complaintNo }, orderBy: { createdAt: 'asc' } });
    return this.toView(row, entries);
  }

  async listAdmin(): Promise<ComplaintListItem[]> {
    const rows = await this.prisma.complaint.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toListItem(r));
  }

  // ── 迁移守卫（铁律④）──────────────────────────────────────────────

  private assertTransition(from: string, to: string): void {
    const allowed = COMPLAINT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Invalid complaint transition ${from} → ${to}`);
  }

  private async transition(row: Complaint, to: string, patch: Record<string, unknown> = {}): Promise<Complaint> {
    this.assertTransition(row.currentStatus, to);
    return this.prisma.complaint.update({ where: { complaintNo: row.complaintNo }, data: { currentStatus: to, ...patch } });
  }

  // ── 提交（spec 双钟：ackDeadlineAt=submittedAt+7d，resolveDeadlineAt=submittedAt+28d）──

  async submit(customerNo: string, dto: SubmitComplaintDto): Promise<{ complaintNo: string }> {
    const submittedAt = new Date();
    const ackDeadlineAt = new Date(submittedAt.getTime() + ACK_DEADLINE_DAYS * 86400000);
    const resolveDeadlineAt = new Date(submittedAt.getTime() + RESOLVE_DEADLINE_DAYS * 86400000);
    const traceId = randomUUID();
    const row = await this.prisma.complaint.create({
      data: {
        complaintNo: generateReferenceNo('CMP'),
        ownerCustomerNo: customerNo,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        relatedOrderNo: dto.relatedOrderNo ?? null,
        currentStatus: ComplaintStatus.RECEIVED,
        submittedAt, ackDeadlineAt, resolveDeadlineAt,
        traceId,
      },
    });
    await this.recordAudit(row, AuditActions.COMPLAINT_SUBMITTED, { kind: 'CUSTOMER', customerNo }, {
      metadata: {
        category: dto.category, ackDeadlineAt: ackDeadlineAt.toISOString(), resolveDeadlineAt: resolveDeadlineAt.toISOString(),
      },
    });
    return { complaintNo: row.complaintNo };
  }

  // ── 确认收悉（RECEIVED→ACKNOWLEDGED；entry CLIENT_MESSAGE/ACK）───────────

  async acknowledge(actor: ApprovalActorContext, complaintNo: string, dto: AcknowledgeComplaintDto): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    const acknowledgedAt = new Date();
    const updated = await this.transition(row, ComplaintStatus.ACKNOWLEDGED, { acknowledgedAt });
    await this.prisma.complaintEntry.create({
      data: {
        complaintNo, kind: ComplaintEntryKinds.CLIENT_MESSAGE, messageType: ComplaintClientMessageTypes.ACK,
        body: dto.message, actorNo: actor.userNo ?? actor.userId,
      },
    });
    await this.recordAudit(updated, AuditActions.COMPLAINT_ACKNOWLEDGED, { kind: 'ADMIN', ctx: actor }, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
    });
    return { complaintNo };
  }

  // ── 立案调查（ACKNOWLEDGED→INVESTIGATING）────────────────────────────

  /** 动作级显式钉死出发态=ACKNOWLEDGED（评审 Critical 1，照 regulatory-filing.service.ts
   *  的 close() 先例：共享迁移表里 RESOLUTION_PENDING→INVESTIGATING 这条边是留给
   *  rejectResolution 内部走的驳回回退边，若本方法只靠共享表隐式挡，会把它当成自己的
   *  合法入口一并借走——从 RESOLUTION_PENDING 直接跳 startInvestigation，能在不清
   *  pendingApprovalNo（审批门仍挂着）的情况下把状态搬回 INVESTIGATING，等于绕过了
   *  审批中态）。不靠表隐式挡，显式判一次状态。 */
  async startInvestigation(actor: ApprovalActorContext, complaintNo: string): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (row.currentStatus !== ComplaintStatus.ACKNOWLEDGED) {
      throw new BadRequestException(`Complaint ${complaintNo} must be ACKNOWLEDGED to start investigation (current status: ${row.currentStatus})`);
    }
    const updated = await this.transition(row, ComplaintStatus.INVESTIGATING);
    await this.recordAudit(updated, AuditActions.COMPLAINT_INVESTIGATION_STARTED, { kind: 'ADMIN', ctx: actor }, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
    });
    return { complaintNo };
  }

  // ── 内部备注（INTERNAL_NOTE；任意非终态可加，不迁状态）───────────────────

  async addNote(actor: ApprovalActorContext, complaintNo: string, body: string): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (COMPLAINT_TERMINAL_STATUSES.includes(row.currentStatus)) {
      throw new BadRequestException(`Complaint ${complaintNo} is in a terminal state (${row.currentStatus}) and cannot accept a new note`);
    }
    await this.prisma.complaintEntry.create({
      data: { complaintNo, kind: ComplaintEntryKinds.INTERNAL_NOTE, body, actorNo: actor.userNo ?? actor.userId },
    });
    await this.recordAudit(row, AuditActions.COMPLAINT_NOTE_ADDED, { kind: 'ADMIN', ctx: actor }, {});
    return { complaintNo };
  }

  // ── 延期（一次性；INVESTIGATING→INVESTIGATING_EXTENDED；resolveDeadlineAt 改
  //     submittedAt+56d；entry CLIENT_MESSAGE/EXTENSION_NOTICE）───────────────

  /** 动作级显式钉死出发态=INVESTIGATING（评审 Critical 1，同 startInvestigation 注释：
   *  共享表里 RESOLUTION_PENDING→INVESTIGATING_EXTENDED 也是留给 rejectResolution 的驳回
   *  回退边——若不显式挡，能从 RESOLUTION_PENDING 直接调 extend 在不清 pendingApprovalNo
   *  的情况下把状态搬到 INVESTIGATING_EXTENDED，同样绕过审批中态，还会顺带造出
   *  「INVESTIGATING 但 extendedAt 有值」这种破坏 rejectResolution 不变量的脏态）。
   *  顺序：一次性守卫（extendedAt）先判——同一张单重复调用 extend 时给"已经延过期一次"
   *  这句更具体的报文；只有从未延期过、但出发态又不对的调用（如直接对 RESOLUTION_PENDING
   *  下手）才会落到出发态守卫。 */
  async extend(actor: ApprovalActorContext, complaintNo: string, dto: ExtendComplaintDto): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (row.extendedAt) {
      throw new BadRequestException(`Complaint ${complaintNo} has already been extended once`);
    }
    if (row.currentStatus !== ComplaintStatus.INVESTIGATING) {
      throw new BadRequestException(`Complaint ${complaintNo} must be INVESTIGATING to extend (current status: ${row.currentStatus})`);
    }
    const extendedAt = new Date();
    const newResolveDeadlineAt = new Date(row.submittedAt.getTime() + EXTENDED_DEADLINE_DAYS * 86400000);
    const updated = await this.transition(row, ComplaintStatus.INVESTIGATING_EXTENDED, {
      extendedAt, resolveDeadlineAt: newResolveDeadlineAt,
    });
    await this.prisma.complaintEntry.create({
      data: {
        complaintNo, kind: ComplaintEntryKinds.CLIENT_MESSAGE, messageType: ComplaintClientMessageTypes.EXTENSION_NOTICE,
        body: dto.explanation, actorNo: actor.userNo ?? actor.userId,
      },
    });
    await this.recordAudit(updated, AuditActions.COMPLAINT_EXTENDED, { kind: 'ADMIN', ctx: actor }, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
      extra: { newResolveDeadlineAt: newResolveDeadlineAt.toISOString() },
      metadata: { newResolveDeadlineAt: newResolveDeadlineAt.toISOString(), explanation: dto.explanation },
    });
    return { complaintNo };
  }

  // ── 裁决三步（ri-replacement 先例）───────────────────────────────────

  /** 提案：→RESOLUTION_PENDING，只记 pendingApprovalNo——outcome/resolutionText 不落本表
   *  （值住 T3 审批单的 objectSnapshot，applyResolution 才真正落库）。approvalNo 由 T3 的
   *  workflow 在开出真审批单之后传入（同 RI recordProposal 先例，此处不再重复
   *  assertNoPendingReplacement 式查重——状态机本身已保证 RESOLUTION_PENDING 无自环，
   *  二次提案会在 transition() 里被 assertTransition 显式拒）。
   *  注（真-RED 实测发现，控制器裁定修正）：COMPLAINT_AUDIT_ACTIONS 的必填字段原名
   *  `outcome`，与审计信封自身的保留字段 outcome（AuditOutcome：SUCCESS/DENIED/FAILED/
   *  PARTIAL，assertActionSpec 用它判定成败分支）撞名——第一版把该键塞成
   *  AuditOutcome.SUCCESS 常量绕过撞名，但那样必填检查对任何业务结论都恒真，是自证型
   *  绿灯，已被控制器打回。现改名 `resolutionOutcome`（常量组同步改名，见
   *  audit-actions.constant.ts 头注释），必填检查重新咬住 dto.outcome 这个真业务值；
   *  信封顶层 outcome 不再显式传（不传即 undefined，走 assertActionSpec 默认的成功分支，
   *  不需要常量硬编码）；展示级镜像仍落 metadata.outcome（R5 惯例不变）。 */
  async proposeResolution(actor: ApprovalActorContext, complaintNo: string, dto: ResolutionDto, approvalNo: string): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    const updated = await this.transition(row, ComplaintStatus.RESOLUTION_PENDING, { pendingApprovalNo: approvalNo });
    await this.recordAudit(updated, AuditActions.COMPLAINT_RESOLUTION_PROPOSED, { kind: 'ADMIN', ctx: actor }, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
      // approvalNo 落信封真列（评审顺手修4，REJECTED 已有——按 approvalNo 查审计三码不漏步）。
      extra: { resolutionOutcome: dto.outcome, approvalNo },
      metadata: { outcome: dto.outcome, resolutionText: dto.resolutionText, approvalNo },
    });
    return { complaintNo };
  }

  /** 生效：→RESOLVED，落 outcome/resolutionText/resolvedAt，entry CLIENT_MESSAGE/
   *  FINAL_RESPONSE，清 pendingApprovalNo。系统动作，无 actor（T3 的 workflow 在审批
   *  裁决 APPROVED 后调用，同 RI applyReplacement 先例，recordSystem）。 */
  async applyResolution(complaintNo: string, approvalNo: string, dto: ResolutionDto): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    const resolvedAt = new Date();
    const updated = await this.transition(row, ComplaintStatus.RESOLVED, {
      resolutionOutcome: dto.outcome, resolutionText: dto.resolutionText, resolvedAt, pendingApprovalNo: null,
    });
    await this.prisma.complaintEntry.create({
      data: {
        complaintNo, kind: ComplaintEntryKinds.CLIENT_MESSAGE, messageType: ComplaintClientMessageTypes.FINAL_RESPONSE,
        body: dto.resolutionText, actorNo: 'SYSTEM',
      },
    });
    await this.recordAudit(updated, AuditActions.COMPLAINT_RESOLUTION_APPLIED, null, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
      // 同 proposeResolution 注释：必填字段咬 resolutionOutcome（业务真值），不再借道信封保留键；
      // approvalNo 同样落信封真列（评审顺手修4）。
      extra: { resolutionOutcome: dto.outcome, approvalNo },
      metadata: { outcome: dto.outcome, resolutionText: dto.resolutionText, approvalNo },
    });
    return { complaintNo };
  }

  /** 驳回/撤单/过期：清 pendingApprovalNo，按 extendedAt 有无回 INVESTIGATING_EXTENDED /
   *  INVESTIGATING 两条显式边（spec 六裁定）。系统动作，无 actor——同 applyResolution。
   *  动作级显式钉死出发态=RESOLUTION_PENDING（评审 Critical 1，同 startInvestigation/
   *  extend 注释：这两条回退边本就是本方法的专属出口，显式判一次比依赖表里恰好没有
   *  自环更稳——不靠"表里没这条边"这种消极事实挡重复驳回/串态调用）。 */
  async rejectResolution(complaintNo: string, approvalNo: string, decision: 'REJECTED' | 'CANCELLED' | 'EXPIRED'): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (row.currentStatus !== ComplaintStatus.RESOLUTION_PENDING) {
      throw new BadRequestException(`Complaint ${complaintNo} must be RESOLUTION_PENDING to reject a resolution (current status: ${row.currentStatus})`);
    }
    const backTo = row.extendedAt ? ComplaintStatus.INVESTIGATING_EXTENDED : ComplaintStatus.INVESTIGATING;
    const updated = await this.transition(row, backTo, { pendingApprovalNo: null });
    await this.recordAudit(updated, AuditActions.COMPLAINT_RESOLUTION_REJECTED, null, {
      fromStatus: row.currentStatus, toStatus: updated.currentStatus,
      extra: { approvalNo, decision },
      metadata: { approvalNo, decision },
    });
    return { complaintNo };
  }

  // ── 升级（不迁状态，只登记引用；守卫：两调查态 + 未升级过）───────────────

  async markEscalated(actor: ApprovalActorContext, complaintNo: string, incidentNo: string): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (!COMPLAINT_INVESTIGATING_STATUSES.includes(row.currentStatus)) {
      throw new BadRequestException(`Complaint ${complaintNo} must be in an investigating status to escalate (current status: ${row.currentStatus})`);
    }
    if (row.escalatedIncidentNo) {
      throw new BadRequestException(`Complaint ${complaintNo} has already been escalated (${row.escalatedIncidentNo})`);
    }
    const updated = await this.prisma.complaint.update({ where: { complaintNo }, data: { escalatedIncidentNo: incidentNo } });
    await this.recordAudit(updated, AuditActions.COMPLAINT_ESCALATED, { kind: 'ADMIN', ctx: actor }, {
      extra: { escalatedIncidentNo: incidentNo },
      metadata: { escalatedIncidentNo: incidentNo },
    });
    return { complaintNo };
  }

  // ── ⚡ 演示装置：拨对应钟至 now-1h；终态（RESOLVED）400 ────────────────────

  async simulateTimeout(actor: ApprovalActorContext, complaintNo: string, target: 'ACK' | 'RESOLVE'): Promise<{ complaintNo: string }> {
    const row = await this.findByNo(complaintNo);
    if (COMPLAINT_TERMINAL_STATUSES.includes(row.currentStatus)) {
      throw new BadRequestException(`Complaint ${complaintNo} is in a terminal state (${row.currentStatus}) and its deadline cannot be fast-forwarded`);
    }
    const deadlineAt = new Date(Date.now() - 3600 * 1000);
    const field = target === 'ACK' ? 'ackDeadlineAt' : 'resolveDeadlineAt';
    const updated = await this.prisma.complaint.update({ where: { complaintNo }, data: { [field]: deadlineAt } });
    await this.recordAudit(updated, AuditActions.COMPLAINT_DEADLINE_FASTFORWARDED, { kind: 'ADMIN', ctx: actor }, {
      extra: { target },
      metadata: { target, deadlineAt: deadlineAt.toISOString() },
    });
    return { complaintNo };
  }

  // ── 审计（十码共用信封；primarySubject 恒为 COMPLAINT/complaintNo；
  //     correlationId 恒继承 row.traceId——SUBMITTED 铸的旅程；OWNER 主体恒为
  //     CUSTOMER/ownerCustomerNo——投诉天然归属一个客户，行上已有该列，不必横向查）──

  private buildAuditInput(row: Complaint, action: string, patch: {
    reason?: string; fromStatus?: string; toStatus?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): any {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.COMPLAINT, subjectNo: row.complaintNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: row.ownerCustomerNo, subjectRole: AuditSubjectRole.OWNER },
    ];
    return {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.COMPLAINT,
      primarySubjectType: AuditEntityTypes.COMPLAINT, primarySubjectNo: row.complaintNo,
      subjects,
      reason: patch.reason, fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      correlationId: row.traceId,
      // 每次写入显式带 requestId——不传会撞同一把 idempotencyKey 被静默去重（同 RI/Filing 先例）。
      requestId: `${action}_${row.complaintNo}_${randomUUID()}`,
      metadata: { complaintNo: row.complaintNo, ...(patch.metadata ?? {}) },
      ...(patch.extra ?? {}),
    };
  }

  private async recordAudit(row: Complaint, action: string, actor: ComplaintActor | null, patch: {
    reason?: string; fromStatus?: string; toStatus?: string;
    metadata?: Record<string, unknown>; extra?: Record<string, unknown>;
  }): Promise<void> {
    if (!actor) {
      const input = { ...this.buildAuditInput(row, action, patch), sourcePlatform: 'SYSTEM' };
      await this.auditLogs.recordSystem(input);
      return;
    }
    if (actor.kind === 'CUSTOMER') {
      const input = { ...this.buildAuditInput(row, action, patch), sourcePlatform: 'CLIENT_API' };
      await this.auditLogs.recordByActor(input, {
        actorType: 'CUSTOMER', actorNo: actor.customerNo, actorDisplayName: actor.customerNo, actorRolesAtTime: ['CUSTOMER'],
      });
      return;
    }
    const display = actor.ctx.userNo ?? actor.ctx.userId;
    const input = { ...this.buildAuditInput(row, action, patch), sourcePlatform: 'ADMIN' };
    await this.auditLogs.recordByActor(input, {
      actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.ctx.roleCodes ?? [],
    });
  }
}
