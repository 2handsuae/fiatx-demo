// 战役乙波一 T3 · LP 档案 workflow（申请 / 启停 / 审批裁决收口）。
// 甲波六 T4：LP 准入改成「先评估后审批」——金库提交申请表（出生 PENDING_ASSESSMENT，同时开尽调评估壳，**不开审批单**）→
// 合规官在尽调评估里逐名筛查 / 定档 / 下结论（退回补料 / 不通过 / 通过并送审）→ 送审时才按风险档开审批单
// （低 / 中 CFO 单步 LP_PROFILE_APPROVAL；高 CFO→高管 LP_PROFILE_HIGH_RISK_APPROVAL）→ 批准 ACTIVE。
// 铁律③各管各的：本文件只调 LpProfileService / DueDiligenceService / DocumentsService 的公开方法与 ApprovalsService 正门，
// 不直写任何表；档案审计全收档案服务，评估审计全收尽调服务，文件审计全收文件服务，本文件零审计写入。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LiquidityProvider } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { DocumentsService, StoredDocumentView, UploadedFileLike } from '../../../core/documents/documents.service';
import { DOCUMENT_OWNER_TYPES, LP_DOC_TYPES } from '../../../core/documents/documents.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { DD_TARGET_TYPES } from '../../governance/compliance-office/due-diligence.constants';
import { DueDiligenceService, DueDiligenceView, SendableInput } from '../../governance/compliance-office/due-diligence.service';
import { ConcludeAssessmentDto, RecordScreeningDto, SaveAssessmentDto } from '../../governance/compliance-office/dto/due-diligence.dto';
import { LpProfileService } from './lp-profile.service';
import {
  CreateLpProfileDto,
  LpProfileStatus,
  ReactivateLpProfileDto,
  ResubmitLpProfileDto,
  SuspendLpProfileDto,
} from './dto/lp-profile.dto';

const TARGET = DD_TARGET_TYPES.LIQUIDITY_PROVIDER;

/** 评估可写窗口（spec §3）：对象在 PENDING_ASSESSMENT 或 RETURNED 时筛查 / 证据 / 定档可写；送审后锁定，撤单回 PENDING_ASSESSMENT 即解锁。 */
const ASSESSABLE_STATUSES: readonly string[] = [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED];

@Injectable()
export class LpProfileWorkflowService {
  constructor(
    private readonly profiles: LpProfileService,
    private readonly approvals: ApprovalsService,
    private readonly dueDiligence: DueDiligenceService,
    private readonly documents: DocumentsService,
  ) {}

  // ── 申请（金库提，合规官评估）─────────────────────────────────────────

  async initiateCreate(dto: CreateLpProfileDto, actor: ApprovalActorContext) {
    const row = await this.profiles.create(actor, dto);
    await this.dueDiligence.open(TARGET, row.lpNo, actor);
    return { lpNo: row.lpNo, status: LpProfileStatus.PENDING_ASSESSMENT };
  }

  /** 被退回后金库改申请重提；评估壳与往轮筛查记录原样保留。 */
  async resubmit(lpNo: string, dto: ResubmitLpProfileDto, actor: ApprovalActorContext) {
    const updated = await this.profiles.resubmit(lpNo, actor, dto);
    return { lpNo, status: updated.status as string };
  }

  // ── 申请文件（六份，都可缺；只在可写窗口内收）──────────────────────────

  async uploadDocument(lpNo: string, docType: string, file: UploadedFileLike, actor: ApprovalActorContext): Promise<{ docNo: string }> {
    const row = await this.profiles.findByNo(lpNo);
    if (!LP_DOC_TYPES.includes(docType)) {
      throw new BadRequestException(`Unknown document type "${docType}" for a liquidity provider — expected one of: ${LP_DOC_TYPES.join(', ')}`);
    }
    if (!ASSESSABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException(`Documents are locked — the application is ${row.status}.`);
    }
    return this.documents.store({ ownerType: DOCUMENT_OWNER_TYPES.LIQUIDITY_PROVIDER, ownerNo: lpNo, docType, file }, actor);
  }

  async listDocuments(lpNo: string): Promise<StoredDocumentView[]> {
    await this.profiles.findByNo(lpNo);
    return this.documents.listByOwner(DOCUMENT_OWNER_TYPES.LIQUIDITY_PROVIDER, lpNo);
  }

  // ── 合规评估（DUE_DILIGENCE_WRITE）：窗口检查在这里，业务规则在尽调服务 ────────

  /** 取评估视图，**一定**带上申请表眼下的名单——不带的话 flags.missingNames 恒为 []，前端会把它读成「全部已筛」。 */
  async getAssessment(lpNo: string): Promise<DueDiligenceView> {
    const row = await this.profiles.findByNo(lpNo);
    const view = await this.dueDiligence.getView(TARGET, lpNo, this.screeningNames(row));
    if (!view) throw new NotFoundException(`Due diligence assessment not found for ${TARGET} ${lpNo}`);
    return view;
  }

  async recordScreening(lpNo: string, dto: RecordScreeningDto, actor: ApprovalActorContext) {
    await this.assertAssessable(lpNo);
    return this.dueDiligence.recordScreening(TARGET, lpNo, dto, actor);
  }

  async attachEvidence(lpNo: string, recordNo: string, file: UploadedFileLike, actor: ApprovalActorContext) {
    await this.assertAssessable(lpNo);
    return this.dueDiligence.attachEvidence(recordNo, file, actor);
  }

  async saveAssessment(lpNo: string, dto: SaveAssessmentDto, actor: ApprovalActorContext) {
    await this.assertAssessable(lpNo);
    return this.dueDiligence.saveAssessment(TARGET, lpNo, dto, actor);
  }

  /** 合规官三选一落结论，并驱动档案沿迁移表走一步。**先落结论，后迁状态**（尽调服务会拒缺原因的退回 / 不通过，
   *  拒了就不碰档案）；送审多一道前置——五道硬规则全过才落结论、才开审批单。
   *  RETURNED 态的档案**不能**再下结论：状态表里 RETURNED 只有「金库重新提交」一条出路，让合规官在退回期间继续筛查 / 定档
   *  是为后续评估备料，但结论要等重提回到 PENDING_ASSESSMENT 后再下——否则会留下「结论已落、状态没动」的半截子。 */
  async conclude(lpNo: string, dto: ConcludeAssessmentDto, actor: ApprovalActorContext): Promise<{ lpNo: string; status: string; approvalNo?: string }> {
    const row = await this.assertAssessable(lpNo);
    if (row.status !== LpProfileStatus.PENDING_ASSESSMENT) {
      throw new BadRequestException(`The application was returned — it must be resubmitted before the assessment can be concluded (status=${row.status}).`);
    }

    switch (dto.conclusion) {
      case 'RETURNED':
      case 'REJECTED': {
        await this.dueDiligence.conclude(TARGET, lpNo, dto, actor);
        const to = dto.conclusion === 'RETURNED' ? LpProfileStatus.RETURNED : LpProfileStatus.REJECTED;
        const updated = await this.profiles.transition(lpNo, to, {}, { actor, reason: dto.reason });
        return { lpNo, status: updated.status as string };
      }
      case 'SENT_FOR_APPROVAL':
        return this.sendForApproval(row, dto, actor);
      default:
        throw new BadRequestException(`Unknown conclusion: ${dto.conclusion}`);
    }
  }

  /** 送审：assertSendable → 落结论 → 迁 PENDING_APPROVAL → 开审批单（提单人 = 合规官，理由 = 评估意见）→ 回填单号。
   *  审批类型按风险档分流：HIGH 走 CFO→高管两步，LOW / MEDIUM 走 CFO 单步。 */
  private async sendForApproval(row: LiquidityProvider, dto: ConcludeAssessmentDto, actor: ApprovalActorContext) {
    const { lpNo } = row;
    const names = this.screeningNames(row);
    await this.dueDiligence.assertSendable(TARGET, lpNo, names);
    const view = await this.dueDiligence.getView(TARGET, lpNo, names);
    if (!view) throw new NotFoundException(`Due diligence assessment not found for ${TARGET} ${lpNo}`);

    await this.dueDiligence.conclude(TARGET, lpNo, dto, actor);
    await this.profiles.transition(lpNo, LpProfileStatus.PENDING_APPROVAL, {}, { actor });
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: view.riskTier === 'HIGH' ? ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL : ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: lpNo,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染（批准人批的不是盲盒：档位 / 附加条件 / 评估号都在）
        objectSnapshot: {
          lpNo, name: row.name, registeredIn: row.registeredIn, licensingAuthority: row.licensingAuthority,
          riskTier: view.riskTier, conditions: view.conditions, assessmentNo: view.assessmentNo,
        },
      },
      { reason: view.opinion ?? undefined },
      actor,
    );
    await this.profiles.stampApprovalNo(lpNo, approval.approvalNo as string);
    return { lpNo, status: LpProfileStatus.PENDING_APPROVAL as string, approvalNo: approval.approvalNo as string };
  }

  // ── 启停（金库提，直接迁移 + 审计，不建审批）───────────────────────────

  async suspend(lpNo: string, dto: SuspendLpProfileDto, actor: ApprovalActorContext) {
    const updated = await this.profiles.transition(lpNo, LpProfileStatus.SUSPENDED, {}, { actor, reason: dto.reason });
    return { lpNo, status: updated.status as string };
  }

  async reactivate(lpNo: string, dto: ReactivateLpProfileDto, actor: ApprovalActorContext) {
    const updated = await this.profiles.transition(lpNo, LpProfileStatus.ACTIVE, {}, { actor, reason: dto.reason });
    return { lpNo, status: updated.status as string };
  }

  // ── 审批裁决（workflowType=LP_PROFILE 的 decided 事件；低 / 中与高风险两种审批同一处理）──────────

  @OnEvent(DOMAIN_EVENTS.LP_PROFILE_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.actionType !== ApprovalActionTypes.LP_PROFILE_APPROVAL && event.actionType !== ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL) return;
    const audit = { approvalNo: event.approvalNo, causationId: event.approvalId };
    if (event.decision === 'APPROVED') {
      await this.profiles.transition(event.entityRef, LpProfileStatus.ACTIVE, {}, audit);
      return;
    }
    if (event.decision === 'CANCELLED') {
      // 撤单（提单人 = 合规官）：回 PENDING_ASSESSMENT 重新评估——评估壳与其结论原样保留，窗口随状态重开
      await this.profiles.transition(event.entityRef, LpProfileStatus.PENDING_ASSESSMENT, {}, { ...audit, reason: event.decisionReason ?? 'Approval cancelled' });
      return;
    }
    const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by approver');
    await this.profiles.transition(event.entityRef, LpProfileStatus.REJECTED, {}, { ...audit, reason: note });
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  /** 可写窗口检查：档案不存在 404；不在 PENDING_ASSESSMENT | RETURNED → 400 Assessment is locked。返回已读到的档案行。 */
  private async assertAssessable(lpNo: string): Promise<LiquidityProvider> {
    const row = await this.profiles.findByNo(lpNo);
    if (!ASSESSABLE_STATUSES.includes(row.status)) throw new BadRequestException('Assessment is locked');
    return row;
  }

  /** 尽调评估要对照的「眼下的名单」：公司法定名称 + 申请表里现有的每位实际控制人；LP 线没有 CISO 信息安全评估。 */
  private screeningNames(row: LiquidityProvider): SendableInput {
    return { companyName: row.name, beneficialOwners: this.profiles.beneficialOwnersOf(row), requireInfosec: false };
  }
}
