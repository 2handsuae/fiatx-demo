// 甲波六 T6 · 服务商准入 workflow（运营申请 / 合规评估 / 按重大性分流审批 / 裁决收口 / 终止）。
// 先评估后审批——运营提交申请表（出生 PENDING_ASSESSMENT，同时开尽调评估壳，**不开审批单**；系统按四问判 MATERIAL / NON_MATERIAL）→
// 合规官在尽调评估里逐名筛查 / 定档 / 下结论（退回补料 / 不通过 / 通过并送审；MATERIAL 另需 CISO 信息安全评估，也可由合规官升档）→
// 送审时才按重大性开审批单（NON_MATERIAL：CFO 单步 VENDOR_APPROVAL；MATERIAL：CFO→高管 VENDOR_MATERIAL_APPROVAL）→
// 批准：一般 ACTIVE；重大 PENDING_NOTIFICATION（VARA 事前报备门）——同时请报送台开一张「重大变更告知」草稿单、把单号盖在服务商上；
// 合规官把那张单走到 SUBMITTED 时报送台发「已报送」事件，本 workflow 按自己记的 notificationFilingNo 认领，PENDING_NOTIFICATION → ACTIVE。
// 终止重大服务商也开一张告知单（不盖章、不认领、不卡终止）。
// 铁律③各管各的：本文件只调 OutsourcingVendorsService / DueDiligenceService / DocumentsService 的公开方法与 ApprovalsService 正门，
// 不直写任何表；服务商审计全收服务商服务，评估审计全收尽调服务，文件审计全收文件服务，报送单审计全收报送台，本文件零审计写入。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OutsourcingVendor } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { DocumentsService, StoredDocumentView, UploadedFileLike } from '../../../core/documents/documents.service';
import { DOCUMENT_OWNER_TYPES, VENDOR_DOC_TYPES } from '../../../core/documents/documents.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../approvals/constants/approval.constants';
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';
import { VendorCriticality, VendorStatus } from './compliance-office.constants';
import { DD_TARGET_TYPES } from './due-diligence.constants';
import { DueDiligenceService, DueDiligenceView, SendableInput } from './due-diligence.service';
import { ApplyVendorBodyDto, ResubmitVendorBodyDto, TerminateVendorBodyDto, UpgradeMaterialityDto } from './dto/compliance-office.dto';
import { ConcludeAssessmentDto, RecordInfosecDto, RecordScreeningDto, SaveAssessmentDto } from './dto/due-diligence.dto';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';

const TARGET = DD_TARGET_TYPES.OUTSOURCING_VENDOR;

/** 评估可写窗口（spec §3）：对象在 PENDING_ASSESSMENT 或 RETURNED 时筛查 / 证据 / 定档 / CISO 评估 / 升档可写；
 *  送审后锁定，撤单回 PENDING_ASSESSMENT 即解锁。 */
const ASSESSABLE_STATUSES: readonly string[] = [VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED];

@Injectable()
export class OutsourcingVendorWorkflowService {
  constructor(
    private readonly vendors: OutsourcingVendorsService,
    private readonly approvals: ApprovalsService,
    private readonly dueDiligence: DueDiligenceService,
    private readonly documents: DocumentsService,
    private readonly filings: RegulatoryFilingService,
  ) {}

  // ── 申请（运营提，合规官评估）─────────────────────────────────────────

  async apply(dto: ApplyVendorBodyDto, actor: ApprovalActorContext): Promise<{ vendorNo: string; status: string; criticality: VendorCriticality }> {
    const { vendorNo, criticality } = await this.vendors.apply(actor, dto);
    await this.dueDiligence.open(TARGET, vendorNo, actor);
    return { vendorNo, status: VendorStatus.PENDING_ASSESSMENT, criticality };
  }

  /** 被退回后运营改申请重提；评估壳与往轮筛查记录原样保留。重大性随表单重算但不降档。 */
  async resubmit(vendorNo: string, dto: ResubmitVendorBodyDto, actor: ApprovalActorContext): Promise<{ vendorNo: string; status: string; criticality: string }> {
    const updated = await this.vendors.resubmit(vendorNo, actor, dto);
    return { vendorNo, status: updated.status, criticality: updated.criticality };
  }

  // ── 申请材料（九类，都可缺；只在可写窗口内收）──────────────────────────

  async uploadDocument(vendorNo: string, docType: string, file: UploadedFileLike, actor: ApprovalActorContext): Promise<{ docNo: string }> {
    const row = await this.vendors.findByNo(vendorNo);
    if (!VENDOR_DOC_TYPES.includes(docType)) {
      throw new BadRequestException(`Unknown document type "${docType}" for a service provider — expected one of: ${VENDOR_DOC_TYPES.join(', ')}`);
    }
    if (!ASSESSABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException(`Documents are locked — the application is ${row.status}.`);
    }
    return this.documents.store({ ownerType: DOCUMENT_OWNER_TYPES.OUTSOURCING_VENDOR, ownerNo: vendorNo, docType, file }, actor);
  }

  async listDocuments(vendorNo: string): Promise<StoredDocumentView[]> {
    await this.vendors.findByNo(vendorNo);
    return this.documents.listByOwner(DOCUMENT_OWNER_TYPES.OUTSOURCING_VENDOR, vendorNo);
  }

  // ── 合规评估（DUE_DILIGENCE_WRITE）+ CISO 评估（INFOSEC_ASSESSMENT_WRITE）：窗口检查在这里，业务规则在尽调服务 ──────

  /** 取评估视图，**一定**带上申请表眼下的名单——不带的话 flags.missingNames 恒为 []，前端会把它读成「全部已筛」。 */
  async getAssessment(vendorNo: string): Promise<DueDiligenceView> {
    const row = await this.vendors.findByNo(vendorNo);
    const view = await this.dueDiligence.getView(TARGET, vendorNo, this.screeningNames(row));
    if (!view) throw new NotFoundException(`Due diligence assessment not found for ${TARGET} ${vendorNo}`);
    return view;
  }

  async recordScreening(vendorNo: string, dto: RecordScreeningDto, actor: ApprovalActorContext) {
    await this.assertAssessable(vendorNo);
    return this.dueDiligence.recordScreening(TARGET, vendorNo, dto, actor);
  }

  async attachEvidence(vendorNo: string, recordNo: string, file: UploadedFileLike, actor: ApprovalActorContext) {
    await this.assertAssessable(vendorNo);
    return this.dueDiligence.attachEvidence(recordNo, file, actor);
  }

  async saveAssessment(vendorNo: string, dto: SaveAssessmentDto, actor: ApprovalActorContext) {
    await this.assertAssessable(vendorNo);
    return this.dueDiligence.saveAssessment(TARGET, vendorNo, dto, actor);
  }

  /** CISO 信息安全评估：与合规评估同一个可写窗口——送审后连同整份评估一起锁。 */
  async recordInfosec(vendorNo: string, dto: RecordInfosecDto, actor: ApprovalActorContext) {
    await this.assertAssessable(vendorNo);
    return this.dueDiligence.recordInfosec(TARGET, vendorNo, dto, actor);
  }

  /** 合规官把 NON_MATERIAL 升为 MATERIAL（必填理由，只升不降）；只在可写窗口内——送审后审批路线已定。 */
  async upgradeMateriality(vendorNo: string, dto: UpgradeMaterialityDto, actor: ApprovalActorContext): Promise<{ vendorNo: string; criticality: VendorCriticality }> {
    await this.assertAssessable(vendorNo);
    await this.vendors.upgradeMateriality(vendorNo, actor, dto.reason);
    return { vendorNo, criticality: 'MATERIAL' };
  }

  /** 合规官三选一落结论，并驱动服务商沿迁移表走一步。**先落结论，后迁状态**（尽调服务会拒缺原因的退回 / 不通过，
   *  拒了就不碰服务商）；送审多一道前置——五道硬规则全过才落结论、才开审批单；
   *  退回也有前置——红灯 / CISO 不可接受时只许「不通过」。
   *  RETURNED 态的服务商**不能**再下结论：状态表里 RETURNED 只有「运营重新提交」一条出路，让合规官在退回期间继续筛查 / 定档
   *  是为后续评估备料，但结论要等重提回到 PENDING_ASSESSMENT 后再下——否则会留下「结论已落、状态没动」的半截子。 */
  async conclude(vendorNo: string, dto: ConcludeAssessmentDto, actor: ApprovalActorContext): Promise<{ vendorNo: string; status: string; approvalNo?: string }> {
    const row = await this.assertAssessable(vendorNo);
    if (row.status !== VendorStatus.PENDING_ASSESSMENT) {
      throw new BadRequestException(`The application was returned — it must be resubmitted before the assessment can be concluded (status=${row.status}).`);
    }

    switch (dto.conclusion) {
      case 'RETURNED':
      case 'REJECTED': {
        // 红灯 / CISO 不可接受时评估结论只许「不通过」——退回补料也拒（「不通过」不经此检查）
        if (dto.conclusion === 'RETURNED') await this.dueDiligence.assertReturnable(TARGET, vendorNo);
        await this.dueDiligence.conclude(TARGET, vendorNo, dto, actor);
        const to = dto.conclusion === 'RETURNED' ? VendorStatus.RETURNED : VendorStatus.REJECTED;
        const updated = await this.vendors.transition(vendorNo, to, {}, { actor, reason: dto.reason });
        return { vendorNo, status: updated.status };
      }
      case 'SENT_FOR_APPROVAL':
        return this.sendForApproval(row, dto, actor);
      default:
        throw new BadRequestException(`Unknown conclusion: ${dto.conclusion}`);
    }
  }

  /** 送审：assertSendable → 落结论 → 迁 PENDING_APPROVAL → 开审批单（提单人 = 合规官，理由 = 评估意见）→ 回填单号。
   *  审批类型按重大性分流：MATERIAL 走 CFO→高管两步，NON_MATERIAL 走 CFO 单步（风险档是合规判断的留痕，不改审批路线）。 */
  private async sendForApproval(row: OutsourcingVendor, dto: ConcludeAssessmentDto, actor: ApprovalActorContext) {
    const { vendorNo } = row;
    const names = this.screeningNames(row);
    await this.dueDiligence.assertSendable(TARGET, vendorNo, names);
    const view = await this.dueDiligence.getView(TARGET, vendorNo, names);
    if (!view) throw new NotFoundException(`Due diligence assessment not found for ${TARGET} ${vendorNo}`);

    await this.dueDiligence.conclude(TARGET, vendorNo, dto, actor);
    await this.vendors.transition(vendorNo, VendorStatus.PENDING_APPROVAL, {}, { actor });
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: row.criticality === 'MATERIAL' ? ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL : ApprovalActionTypes.VENDOR_APPROVAL,
        entityRef: vendorNo,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染（批准人批的不是盲盒：重大性 / 档位 / 评估号都在）
        objectSnapshot: {
          vendorNo, name: row.name, serviceDescription: row.serviceDescription, criticality: row.criticality,
          deliveryLocations: row.deliveryLocations ? row.deliveryLocations.split(',') : [],
          riskTier: view.riskTier, assessmentNo: view.assessmentNo,
        },
      },
      { reason: view.opinion ?? undefined },
      actor,
    );
    await this.vendors.stampApprovalNo(vendorNo, approval.approvalNo as string);
    return { vendorNo, status: VendorStatus.PENDING_APPROVAL as string, approvalNo: approval.approvalNo as string };
  }

  // ── 终止（合规官，直接迁移 + 审计，不建审批）──────────────────────────

  async terminate(vendorNo: string, dto: TerminateVendorBodyDto, actor: ApprovalActorContext): Promise<{ vendorNo: string; status: string }> {
    await this.vendors.terminate(vendorNo, actor, dto);
    // 终止重大服务商同样要告知 VARA：先终止、后开单——终止不依赖告知单；这张单**不盖** notificationFilingNo（终止不等它，
    // 它的「已报送」事件也认领不到任何服务商）。一般服务商不开单。
    const row = await this.vendors.findByNo(vendorNo);
    if (row.criticality === 'MATERIAL') {
      await this.filings.openForVendorNotification(this.notificationInput(row, 'TERMINATION'));
    }
    return { vendorNo, status: VendorStatus.TERMINATED };
  }

  // ── 审批裁决（workflowType=OUTSOURCING_VENDOR 的 decided 事件；一般与重大两种审批同一处理）──────────

  @OnEvent(DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.actionType !== ApprovalActionTypes.VENDOR_APPROVAL && event.actionType !== ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL) return;
    const audit = { approvalNo: event.approvalNo, causationId: event.approvalId };
    if (event.decision === 'APPROVED') {
      const row = await this.vendors.findByNo(event.entityRef);
      if (row.criticality === 'MATERIAL') {
        // 报备门：重大服务商批了也还不能 ACTIVE，落 PENDING_NOTIFICATION 等 VARA 事前报备。付款门 assertActiveByNo 因此拦住它。
        await this.vendors.transition(event.entityRef, VendorStatus.PENDING_NOTIFICATION, {}, audit);
        // 请报送台开告知单 → 单号盖回服务商（报送单表无 entityRef，关联方向是服务商自己记）。盖章时服务商服务写 VENDOR_NOTIFICATION_OPENED。
        // 非原子（照实，同 RI 换人先例）：状态已落 PENDING_NOTIFICATION 后若开单抛错，不补偿、不重试——见 PRODUCTION-NOTES「onDecided 异常被吞」条。
        const { filingNo } = await this.filings.openForVendorNotification(this.notificationInput(row, 'ONBOARDING', event.approvalNo));
        await this.vendors.stampNotificationFilingNo(event.entityRef, filingNo);
        return;
      }
      await this.vendors.transition(event.entityRef, VendorStatus.ACTIVE, {}, audit);
      return;
    }
    if (event.decision === 'CANCELLED') {
      // 撤单（提单人 = 合规官）：回 PENDING_ASSESSMENT 重新评估——评估壳与其结论原样保留，窗口随状态重开
      await this.vendors.transition(event.entityRef, VendorStatus.PENDING_ASSESSMENT, {}, { ...audit, reason: event.decisionReason ?? 'Approval cancelled' });
      return;
    }
    const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by approver');
    await this.vendors.transition(event.entityRef, VendorStatus.REJECTED, {}, { ...audit, reason: note });
  }

  // ── 报送台「已报送」事件（VARA 报备门认领）────────────────────────────

  /** 报送台把某张单标记为已报送（regulatory-filing.submitted）。只认领**自己开出并盖了章**的那张告知单：
   *  按 notificationFilingNo 反查服务商，且它此刻必须还是 PENDING_NOTIFICATION → ACTIVE。其余一律静默忽略、不抛——
   *  别的报送单（周期报送 / 事故通报 / RI 换人告知…）、终止联动那张（从不盖章）、服务商早已不在待报备态，都不归这里管。
   *  出发态钉死 PENDING_NOTIFICATION（本仓库每个 transition 调用方都钉自己的出发态）：迁移表里通向 ACTIVE 的边有两条，
   *  不钉的话一条带着告知单号却停在 PENDING_APPROVAL 的行会被这个事件无痕放进 ACTIVE，绕开审批门。 */
  @OnEvent(DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED.name, { async: true })
  async onFilingSubmitted(event: { filingNo: string; type: string; externalRef: string }): Promise<void> {
    const vendor = await this.vendors.findByNotificationFilingNo(event.filingNo);
    if (!vendor || vendor.status !== VendorStatus.PENDING_NOTIFICATION) return;
    await this.vendors.transition(vendor.vendorNo, VendorStatus.ACTIVE, {}, {
      causationId: event.filingNo,
      reason: `VARA notification submitted — ref ${event.externalRef}`,
    });
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  /** 告知单入参：服务商快照原样直传（报送台不越域读服务商表）；合同起始日按 UTC 日历日取（库里存的就是 UTC 零点，不过本地时区）。 */
  private notificationInput(row: OutsourcingVendor, reason: 'ONBOARDING' | 'TERMINATION', approvalNo?: string) {
    return {
      vendorNo: row.vendorNo,
      vendorName: row.name,
      serviceDescription: row.serviceDescription,
      deliveryLocations: row.deliveryLocations ? row.deliveryLocations.split(',') : [],
      criticality: 'MATERIAL' as const,
      contractStart: row.contractStart.toISOString().slice(0, 10),
      ...(approvalNo !== undefined ? { approvalNo } : {}),
      reason,
    };
  }

  /** 可写窗口检查：服务商不存在 404；不在 PENDING_ASSESSMENT | RETURNED → 400 Assessment is locked。返回已读到的行。 */
  private async assertAssessable(vendorNo: string): Promise<OutsourcingVendor> {
    const row = await this.vendors.findByNo(vendorNo);
    if (!ASSESSABLE_STATUSES.includes(row.status)) throw new BadRequestException('Assessment is locked');
    return row;
  }

  /** 尽调评估要对照的「眼下的名单」：公司法定名称 + 申请表里现有的每位实际控制人；重大服务商另需 CISO 信息安全评估。 */
  private screeningNames(row: OutsourcingVendor): SendableInput {
    return { companyName: row.name, beneficialOwners: this.vendors.beneficialOwnersOf(row), requireInfosec: row.criticality === 'MATERIAL' };
  }
}
