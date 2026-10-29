// 甲波六 T3 · 尽调评估主体 DueDiligenceAssessment（DDA…）+ 下挂筛查记录 ScreeningRecord（SCR…）。
// 铁律③：本服务只写自己的两张表（due_diligence_assessments / screening_records）；证据截图的落盘与元数据
// 交给 DocumentsService（它是 stored_documents 的唯一写者）。LP 线（T4）与服务商线（T6）的 workflow 调本服务：
// 先 assertSendable 过五道硬规则（退回则先 assertReturnable 过红灯 / CISO 不可接受这两道），再 conclude 落结论——
// conclude 自己不做规则检查，只落结论。
// 本服务**不看**目标（LP / 服务商）当前状态：「可写窗口」（PENDING_ASSESSMENT / RETURNED 才可写）由两线 workflow
// 各自的 assertAssessable 把关（spec §3）。评估不设状态列，所以本主体没有迁移表。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DueDiligenceAssessment, ScreeningRecord } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DocumentsService, UploadedFileLike } from '../../../core/documents/documents.service';
import { DOCUMENT_OWNER_TYPES, SCREENING_DOC_TYPES } from '../../../core/documents/documents.constants';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole, CreateAuditLogEventDto } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { DdTargetType } from './due-diligence.constants';
import { ConcludeAssessmentDto, RecordInfosecDto, RecordScreeningDto, SaveAssessmentDto } from './dto/due-diligence.dto';

export interface ScreeningRecordView {
  recordNo: string;
  subjectKind: string;
  subjectName: string;
  uboSeq: number | null;
  listsChecked: string[];
  result: string;
  screenedAt: string;
  evidenceDocNo: string | null;
  recordedBy: string;
}

/** 前端据此决定按钮：hasRed / infosecBlocked → 只剩「不通过」（「通过并送审」「退回补料」都不出现，后端 assertSendable / assertReturnable 同守）；
 *  missingNames 非空 → 置灰并提示缺谁。 */
export interface DueDiligenceFlags {
  hasRed: boolean;
  missingNames: string[];
  infosecBlocked: boolean;
}

export interface DueDiligenceView {
  assessmentNo: string;
  targetType: string;
  targetNo: string;
  riskTier: string | null;
  opinion: string | null;
  conditions: string | null;
  conclusion: string | null;
  conclusionReason: string | null;
  concludedAt: string | null;
  infosec: {
    soc2: string | null;
    iso27001: string | null;
    dataLocationAcceptable: boolean | null;
    drPlanAcceptable: boolean | null;
    opinion: string | null;
    verdict: string | null;
    recordedBy: string | null;
    recordedAt: string | null;
  } | null;
  screeningRecords: ScreeningRecordView[];
  flags: DueDiligenceFlags;
}

/** 被评估对象眼下的名单：公司名 + 申请表里现有的每一位实际控制人（seq + 姓名）。 */
export interface ScreeningNames {
  companyName: string;
  beneficialOwners: { seq: number; name: string }[];
}

export type SendableInput = ScreeningNames & { requireInfosec: boolean };

/** 词表 requiredFields 要求在 input 顶层（assertActionSpec 只查顶层），DTO 里没声明，用交叉类型承载。 */
type DdAuditEnvelope = CreateAuditLogEventDto & {
  workflowType: string;
  targetType?: string;
  result?: string;
  riskTier?: string;
  verdict?: string;
  conclusion?: string;
};

/** 名字比对口径：首尾空白去掉、大小写不敏感。 */
const normalizeName = (s: string): string => s.trim().toLowerCase();

@Injectable()
export class DueDiligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly documents: DocumentsService,
  ) {}

  // ── 开壳 ────────────────────────────────────────────────────────────

  /** 同一目标只开一份：已存在则原样返回（不重开、不重复审计）。 */
  async open(targetType: DdTargetType, targetNo: string, actor: ApprovalActorContext): Promise<{ assessmentNo: string }> {
    const existing = await this.findRow(targetType, targetNo);
    if (existing) return { assessmentNo: existing.assessmentNo };
    const row = await this.prisma.dueDiligenceAssessment.create({
      data: {
        assessmentNo: generateReferenceNo('DDA'),
        targetType, targetNo,
        createdByUserId: actor.userNo ?? actor.userId,
      },
    });
    await this.recordAudit(row, AuditActions.DD_ASSESSMENT_OPENED, actor, {
      extra: { targetType },
      metadata: { targetType, targetNo },
    });
    return { assessmentNo: row.assessmentNo };
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  /** 无评估壳 → null。不传 input 时 flags 只算得出 hasRed / infosecBlocked，missingNames 恒为空（缺名要对照
   *  目标眼下的名单才算得出，名单在 LP / 服务商那边，本服务不替它们读）；要缺名提示就传 input。 */
  async getView(targetType: DdTargetType, targetNo: string, input?: ScreeningNames & { requireInfosec?: boolean }): Promise<DueDiligenceView | null> {
    const row = await this.findRow(targetType, targetNo);
    if (!row) return null;
    const records = await this.loadRecords(row);
    return this.toView(row, records, this.computeFacts(row, records, input));
  }

  // ── 逐名筛查 ────────────────────────────────────────────────────────

  async recordScreening(targetType: DdTargetType, targetNo: string, dto: RecordScreeningDto, actor: ApprovalActorContext): Promise<{ recordNo: string }> {
    const row = await this.requireRow(targetType, targetNo);
    const isUbo = dto.subjectKind === 'BENEFICIAL_OWNER';
    const rec = await this.prisma.screeningRecord.create({
      data: {
        recordNo: generateReferenceNo('SCR'),
        assessmentId: row.id,
        subjectKind: dto.subjectKind,
        subjectName: dto.subjectName,
        uboSeq: isUbo ? dto.uboSeq ?? null : null,
        listsChecked: dto.listsChecked.join(','),
        result: dto.result,
        screenedAt: dto.screenedAt ? new Date(dto.screenedAt) : new Date(),
        recordedByUserId: actor.userNo ?? actor.userId,
      },
    });
    await this.recordAudit(row, AuditActions.DD_SCREENING_RECORDED, actor, {
      extra: { result: rec.result },
      metadata: {
        recordNo: rec.recordNo, subjectKind: rec.subjectKind, subjectName: rec.subjectName,
        uboSeq: rec.uboSeq, listsChecked: dto.listsChecked, result: rec.result,
      },
      recordNo: rec.recordNo,
    });
    return { recordNo: rec.recordNo };
  }

  /** 证据截图：先按 recordNo 找到记录（找不到 404，不动文件存储）；文件落盘与 DOCUMENT_UPLOADED 审计由
   *  DocumentsService 负责，本方法只把返回的 DOC 号回写到记录上（重传即替换指向，旧文件仍留在存储里）。 */
  async attachEvidence(recordNo: string, file: UploadedFileLike, actor: ApprovalActorContext): Promise<{ docNo: string }> {
    const rec = await this.prisma.screeningRecord.findUnique({ where: { recordNo } });
    if (!rec) throw new NotFoundException(`Screening record not found: ${recordNo}`);
    const { docNo } = await this.documents.store(
      { ownerType: DOCUMENT_OWNER_TYPES.SCREENING_RECORD, ownerNo: recordNo, docType: SCREENING_DOC_TYPES[0], file },
      actor,
    );
    await this.prisma.screeningRecord.update({ where: { recordNo }, data: { evidenceDocNo: docNo } });
    return { docNo };
  }

  // ── 定档 / CISO ─────────────────────────────────────────────────────

  async saveAssessment(targetType: DdTargetType, targetNo: string, dto: SaveAssessmentDto, actor: ApprovalActorContext): Promise<void> {
    const row = await this.requireRow(targetType, targetNo);
    const updated = await this.prisma.dueDiligenceAssessment.update({
      where: { assessmentNo: row.assessmentNo },
      data: { riskTier: dto.riskTier, opinion: dto.opinion, conditions: dto.conditions ?? null },
    });
    await this.recordAudit(updated, AuditActions.DD_ASSESSMENT_SAVED, actor, {
      extra: { riskTier: dto.riskTier },
      metadata: { riskTier: dto.riskTier, opinion: dto.opinion, conditions: dto.conditions ?? null },
    });
  }

  async recordInfosec(targetType: DdTargetType, targetNo: string, dto: RecordInfosecDto, actor: ApprovalActorContext): Promise<void> {
    const row = await this.requireRow(targetType, targetNo);
    const updated = await this.prisma.dueDiligenceAssessment.update({
      where: { assessmentNo: row.assessmentNo },
      data: {
        infosecSoc2: dto.soc2, infosecIso27001: dto.iso27001,
        infosecDataLocationOk: dto.dataLocationAcceptable, infosecDrPlanOk: dto.drPlanAcceptable,
        infosecOpinion: dto.opinion, infosecVerdict: dto.verdict,
        infosecByUserId: actor.userNo ?? actor.userId, infosecAt: new Date(),
      },
    });
    await this.recordAudit(updated, AuditActions.DD_INFOSEC_RECORDED, actor, {
      extra: { verdict: dto.verdict },
      metadata: {
        verdict: dto.verdict, soc2: dto.soc2, iso27001: dto.iso27001,
        dataLocationAcceptable: dto.dataLocationAcceptable, drPlanAcceptable: dto.drPlanAcceptable, opinion: dto.opinion,
      },
    });
  }

  // ── 结论前置检查（workflow 在 conclude 之前调） ──────────────────────

  /** 送审（SENT_FOR_APPROVAL）五道顺序检查，第一道不过就抛，不攒错。① 任一记录为红 ② 公司名 / 现任每位实控人无匹配记录
   *  ③ 未定档 ④ 需要 CISO 却没结论 ⑤ CISO 结论不可接受。②③④ 只拦「通过并送审」。 */
  async assertSendable(targetType: DdTargetType, targetNo: string, input: SendableInput): Promise<void> {
    const row = await this.requireRow(targetType, targetNo);
    const facts = this.computeFacts(row, await this.loadRecords(row), input);
    this.assertNoRed(facts);
    if (facts.missingNames.length > 0) {
      throw new BadRequestException(`Screening missing for: ${facts.missingNames.join(', ')}`);
    }
    if (!row.riskTier) {
      throw new BadRequestException('Risk tier not set');
    }
    if (input.requireInfosec && !row.infosecVerdict) {
      throw new BadRequestException('Waiting for CISO information-security assessment');
    }
    this.assertInfosecAcceptable(facts);
  }

  /** 退回（RETURNED）前置检查：只有 ① 红灯 ⑤ CISO 不可接受 这两道（同款文案、同款顺序）——红灯 / 不可接受时评估结论只许
   *  「不通过」（spec §3 / §5.3），退回补料也不行。缺名 / 未定档 / 等 CISO 不拦退回。「不通过」不经任何前置检查。 */
  async assertReturnable(targetType: DdTargetType, targetNo: string): Promise<void> {
    const row = await this.requireRow(targetType, targetNo);
    const facts = this.computeFacts(row, await this.loadRecords(row));
    this.assertNoRed(facts);
    this.assertInfosecAcceptable(facts);
  }

  private assertNoRed(facts: DueDiligenceFlags): void {
    if (facts.hasRed) throw new BadRequestException('Screening hit (RED) — only REJECT is allowed');
  }

  private assertInfosecAcceptable(facts: DueDiligenceFlags): void {
    if (facts.infosecBlocked) throw new BadRequestException('CISO verdict UNACCEPTABLE — only REJECT is allowed');
  }

  // ── 落结论（覆盖存最新一轮；往轮历史看审计） ──────────────────────────

  /** 只落结论，不做规则检查（由 workflow 先调：送审调 assertSendable、退回调 assertReturnable、不通过不调）。RETURNED / REJECTED 必带 reason。 */
  async conclude(targetType: DdTargetType, targetNo: string, dto: ConcludeAssessmentDto, actor: ApprovalActorContext): Promise<void> {
    const row = await this.requireRow(targetType, targetNo);
    const needsReason = dto.conclusion === 'RETURNED' || dto.conclusion === 'REJECTED';
    if (needsReason && !dto.reason?.trim()) {
      throw new BadRequestException(`A reason is required when the conclusion is ${dto.conclusion}`);
    }
    const updated = await this.prisma.dueDiligenceAssessment.update({
      where: { assessmentNo: row.assessmentNo },
      data: {
        conclusion: dto.conclusion, conclusionReason: dto.reason ?? null,
        concludedAt: new Date(), concludedByUserId: actor.userNo ?? actor.userId,
      },
    });
    await this.recordAudit(updated, AuditActions.DD_ASSESSMENT_CONCLUDED, actor, {
      extra: { conclusion: dto.conclusion },
      metadata: { conclusion: dto.conclusion, reason: dto.reason ?? null, riskTier: updated.riskTier },
    });
  }

  // ── 内部：取数 ──────────────────────────────────────────────────────

  private findRow(targetType: DdTargetType, targetNo: string): Promise<DueDiligenceAssessment | null> {
    return this.prisma.dueDiligenceAssessment.findUnique({ where: { targetType_targetNo: { targetType, targetNo } } });
  }

  private async requireRow(targetType: DdTargetType, targetNo: string): Promise<DueDiligenceAssessment> {
    const row = await this.findRow(targetType, targetNo);
    if (!row) throw new NotFoundException(`Due diligence assessment not found for ${targetType} ${targetNo}`);
    return row;
  }

  private loadRecords(row: DueDiligenceAssessment): Promise<ScreeningRecord[]> {
    return this.prisma.screeningRecord.findMany({ where: { assessmentId: row.id }, orderBy: { createdAt: 'asc' } });
  }

  // ── 内部：事实计算（getView / assertSendable / assertReturnable 共用，规则只在这一处） ─────

  /** 「已筛」判定（R4）：一位当事人只有在存在**身份对得上**的记录时才算已筛——
   *  公司：subjectKind=COMPANY 且名字相同；实控人：subjectKind=BENEFICIAL_OWNER 且 uboSeq 相同且名字相同。
   *  名字比对首尾去空白、大小写不敏感。这样金库补料时增了人要补筛；换了人（甚至复用同一 seq）也不会
   *  继承被删者的记录；删了人，其记录留着、不再计入。红灯规则则是字面的：评估下任一记录为红即拦。
   *  无 input（只想要红灯 / CISO 旗标）时 missingNames 恒为空。 */
  private computeFacts(row: DueDiligenceAssessment, records: ScreeningRecord[], input?: ScreeningNames): DueDiligenceFlags {
    const missingNames: string[] = [];
    if (input) {
      const companyScreened = records.some(
        (r) => r.subjectKind === 'COMPANY' && normalizeName(r.subjectName) === normalizeName(input.companyName),
      );
      if (!companyScreened) missingNames.push(input.companyName);
      for (const ubo of input.beneficialOwners) {
        const screened = records.some(
          (r) => r.subjectKind === 'BENEFICIAL_OWNER' && r.uboSeq === ubo.seq && normalizeName(r.subjectName) === normalizeName(ubo.name),
        );
        if (!screened) missingNames.push(ubo.name);
      }
    }
    return {
      hasRed: records.some((r) => r.result === 'RED'),
      missingNames,
      infosecBlocked: row.infosecVerdict === 'UNACCEPTABLE',
    };
  }

  private toView(row: DueDiligenceAssessment, records: ScreeningRecord[], flags: DueDiligenceFlags): DueDiligenceView {
    return {
      assessmentNo: row.assessmentNo,
      targetType: row.targetType, targetNo: row.targetNo,
      riskTier: row.riskTier, opinion: row.opinion, conditions: row.conditions,
      conclusion: row.conclusion, conclusionReason: row.conclusionReason,
      concludedAt: row.concludedAt ? row.concludedAt.toISOString() : null,
      infosec: row.infosecVerdict
        ? {
            soc2: row.infosecSoc2, iso27001: row.infosecIso27001,
            dataLocationAcceptable: row.infosecDataLocationOk, drPlanAcceptable: row.infosecDrPlanOk,
            opinion: row.infosecOpinion, verdict: row.infosecVerdict,
            recordedBy: row.infosecByUserId, recordedAt: row.infosecAt ? row.infosecAt.toISOString() : null,
          }
        : null,
      screeningRecords: records.map((r) => ({
        recordNo: r.recordNo, subjectKind: r.subjectKind, subjectName: r.subjectName, uboSeq: r.uboSeq,
        listsChecked: r.listsChecked ? r.listsChecked.split(',') : [],
        result: r.result, screenedAt: r.screenedAt.toISOString(),
        evidenceDocNo: r.evidenceDocNo, recordedBy: r.recordedByUserId,
      })),
      flags,
    };
  }

  // ── 审计（五码共用信封：domain GOVERNANCE，workflowType DUE_DILIGENCE；primary = 评估壳，目标（LP / 服务商）
  //     为 RELATED；correlationId 恒为 assessmentNo——OPENED 铸旅程，其余四码继承；requestId 显式带 action +
  //     assessmentNo + uuid，否则同一 (action, subject, correlation) 的第二次调用会被幂等键静默吞掉）──────────

  private async recordAudit(row: DueDiligenceAssessment, action: string, actor: ApprovalActorContext, patch: {
    metadata: Record<string, unknown>;
    extra: Pick<DdAuditEnvelope, 'targetType' | 'result' | 'riskTier' | 'verdict' | 'conclusion'>;
    /** 本次审计另挂一条 RELATED 的筛查记录子主体（仅 DD_SCREENING_RECORDED）。 */
    recordNo?: string;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.DUE_DILIGENCE_ASSESSMENT, subjectNo: row.assessmentNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes[row.targetType as DdTargetType], subjectNo: row.targetNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (patch.recordNo) {
      subjects.push({ subjectType: AuditEntityTypes.SCREENING_RECORD, subjectNo: patch.recordNo, subjectRole: AuditSubjectRole.RELATED });
    }
    const envelope: DdAuditEnvelope = {
      action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.DUE_DILIGENCE,
      primarySubjectType: AuditEntityTypes.DUE_DILIGENCE_ASSESSMENT, primarySubjectNo: row.assessmentNo,
      subjects,
      correlationId: row.assessmentNo,
      requestId: `${action}_${row.assessmentNo}_${randomUUID()}`,
      metadata: { assessmentNo: row.assessmentNo, targetType: row.targetType, targetNo: row.targetNo, ...patch.metadata },
      sourcePlatform: 'ADMIN',
      ...patch.extra,
    };
    const display = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(envelope, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
  }
}
