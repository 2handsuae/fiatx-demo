// 平账三期 · 事故登记（Task 7）：结案编排点。
// 铁律③：审批是另一个主体（ApprovalsService），跨主体协作只发生在 workflow——
// requestClose 的守卫、objectSnapshot、onDecided 的裁决落地都放这里；对 incidents 表
// 的实际读写全部经 IncidentService 的三个纯方法（findRemediations/markCloseRequested/
// close），本文件不直碰 incidents/incident_remediations 表。
// 模板逐处照抄 internal-transfer-workflow.service.ts 的 submitForApproval（
// approvals.createAndSubmit 用法、objectSnapshot 零 UUID）与 onDecided（@OnEvent 二级
// 事件、非 APPROVED 分支的处理方式）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActorContext, DEFAULT_APPROVAL_POLICIES } from '../approvals/constants/approval.constants';
import { IncidentStatus } from './incident.constants';
import { getIncidentTypeConfig, INCIDENT_TYPE_REGISTRY } from './incident-type-registry';
import { IncidentService } from './incident.service';
// 战役甲波二 T6：结案守卫改判为报送单口径——事故自己的 reportedAt 已退役，通报是否完成
// 改横向只读 RegulatoryFilingService.summaryForIncident（铁律③读放行）。
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';

// 走查发现 Fix 1：结案审批页是 MLRO/CFO 的最后一道人闸，其余审批类型（模板见
// internal-transfer-workflow.service.ts 的 impact 串）都给裁决人一句人话后果描述，
// 事故结案此前没有——裁决人只看得到裸字段，读不出"批下去会怎样"。
// 战役甲波一 T8 修复轮 1（评审 I1 d）：类型人话标签改从 INCIDENT_TYPE_REGISTRY 派生，不再
// 手抄——手抄只覆盖了旧三类且措辞与注册表 label 不同字（"Large unexplained" vs 注册表的
// "Large unexplained discrepancy"），十类终盘另外七类此前会掉进下面 `?? row.type` 兜底、
// 摘要里直接出现生码（如 "CYBER_BCDR"）。派生方式保证永远与注册表同步，不会再次漂移。
const INCIDENT_TYPE_IMPACT_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(INCIDENT_TYPE_REGISTRY).map(([type, cfg]) => [type, cfg.label]),
);
// 战役甲波一 Task 8 追加指令②：T6 新增的 IMPACT/SHORTFALL 两档口径此前没有对应人话动词，
// 结案摘要遇到 SERVICE_IMPACT/DATA_IMPACT/SHORTFALL 会退化成生码（basisVerb ?? row.assessmentBasis
// 分支兜底），本轮补齐三值，与既有 MONETARY 四值同构措辞。
const ASSESSMENT_BASIS_IMPACT_VERB: Record<string, string> = {
  RECOVERED: 'recovered', FIRM_LOSS: 'loss recognized', CLIENT_COLLECTION: 'pursuing collection', NO_LOSS: 'no loss',
  SERVICE_IMPACT: 'service impact assessed', DATA_IMPACT: 'data impact assessed', SHORTFALL: 'shortfall assessed',
};

@Injectable()
export class IncidentCloseWorkflowService {
  constructor(
    private readonly incidents: IncidentService,
    private readonly approvals: ApprovalsService,
    private readonly auditLogs: AuditLogsService,
    private readonly filings: RegulatoryFilingService,
  ) {}

  /**
   * 申请结案（真正入口，HTTP 层调这个，不直接调 IncidentService）。
   * 前置：状态 ∈ {ASSESSED（仅"无善后径"——定损口径 NO_LOSS，或该类型压根没有可挂载的善后
   * 动作——且零善后挂载）, RESOLVING}；REGISTERED/INVESTIGATING（还没定损）→ 400（变异靶子①：
   * 这条守卫必须单独测）。reportRequired=true 而报送单未全部提交（甲波二 T6：改横向只读
   * RegulatoryFilingService.summaryForIncident，见下方守卫实现）→ 400（通报没留痕不许关）。
   *
   * 战役甲波一 T8 修复轮 1（评审 C1·Critical，裁决 Ruling-10 采乙案）：ASSESSED→CLOSED 这条边
   * 语义是"无善后"，不是"assessmentBasis 字面等于 NO_LOSS"——旧写法把两者当同一件事，导致
   * CYBER_BCDR/OUTSOURCING_FAILURE/STUCK_TRANSACTION_MAJOR/PRUDENTIAL_BREACH 四类（注册表
   * allowedRemediationKinds 为空集，压根没有善后动作可挂）永远无法从 ASSESSED 直接结案——
   * 它们的 assessmentScheme 是 IMPACT/MONETARY/SHORTFALL，assessmentBasis 取值集里根本没有
   * 'NO_LOSS'（见 incident-type-registry.ts 的 ASSESSMENT_BASIS_BY_SCHEME），旧守卫会把它们
   * 全部错误地打回"必须先进 RESOLVING"，而 RESOLVING 本该是"有善后动作要挂"的状态，这四类
   * 根本挂不了任何善后（白名单为空），变成结案不可达的死结。spec §1：处置（善后）可选；
   * ASSESSED→CLOSED 边本为"无善后"而设，不是"MONETARY 口径认定无损失"专属。DATA_BREACH/
   * ASSET_NONCOMPLIANCE 的 allowedRemediationKinds 非空（各自可挂 CUSTOMER_NOTICE_LOGGED /
   * ASSET_SUSPENSION_REF），故仍须先进 RESOLVING 挂动作，不受本次放宽影响。
   */
  async requestClose(incidentNo: string, actor: ApprovalActorContext): Promise<{ incidentNo: string; approvalNo: string }> {
    const row = await this.incidents.findByNo(incidentNo);
    // 战役甲波一 T5（经办桶断言，门不可绕）：结案入口复用 IncidentService.assertOperator
    // ——不在本服务另注入 AccessControlService（改动最小方案，见 task-5-brief Ruling）。
    const typeConfig = getIncidentTypeConfig(row.type);
    await this.incidents.assertOperator(typeConfig, actor);
    const remediationReferenceNos = await this.incidents.findRemediations(incidentNo);

    if (row.status === IncidentStatus.ASSESSED) {
      // T11 修（T8 遗留：拒绝文案歧义）：两条真实失败原因分开报，不再把"该类型压根没有
      // 处置动作"包装成挡在 noRemediationPath 判断里的又一个理由词——那样读起来像是
      // "conclusion is not no-loss（或者这个类型没善后动作，这也算一个理由）"，误导裁决
      // 之外的读者以为"允许无善后"本身就是被拒的原因。真正的两支互斥原因：①这类事故的
      // 定损结论或类型白名单要求它走善后（noRemediationPath 为假）；②虽然按口径可以无
      // 善后直接关单，但已经有善后单挂在事故上，必须先进 Resolving 收尾这些挂载。
      const noRemediationPath = row.assessmentBasis === 'NO_LOSS' || typeConfig.allowedRemediationKinds.length === 0;
      if (!noRemediationPath) {
        throw new BadRequestException(`Incident ${incidentNo} assessment concluded remediation is required for this type — it must enter Resolving and link remediation before close can be requested`);
      }
      if (remediationReferenceNos.length > 0) {
        throw new BadRequestException(`Incident ${incidentNo} already has remediation linked — it must enter Resolving before close can be requested`);
      }
    } else if (row.status !== IncidentStatus.RESOLVING) {
      if (row.status === IncidentStatus.CLOSED) {
        throw new BadRequestException(`Incident ${incidentNo} is already closed — close cannot be requested again`);
      }
      if (row.status === IncidentStatus.WITHDRAWN) {
        throw new BadRequestException(`Incident ${incidentNo} has been withdrawn — close cannot be requested`);
      }
      throw new BadRequestException(`Incident ${incidentNo} is in status ${row.status} — close cannot be requested until assessment is complete (Assessed or Resolving)`);
    }
    // 战役甲波二 T6：结案守卫改判为报送单口径——事故自己不再存 reportedAt（单槽六列已退役），
    // 通报是否完成改横向只读 RegulatoryFilingService.summaryForIncident（铁律③读放行）。
    // basisCode!=null 过滤掉非事故通报类型的杂项（本查询按 incidentNo 过滤，理论上不会混入，
    // 纯防御）；status!=='CANCELLED' 过滤掉已作废单——作废不代表义务免除，但也不该拿一张
    // 作废单去卡"未提交"，故不计入 unsubmitted 判断。
    let reported = false;
    if (row.reportRequired) {
      const filingRows = (await this.filings.summaryForIncident(incidentNo))
        .filter((f) => f.basisCode != null && f.status !== 'CANCELLED');
      const unsubmitted = filingRows.filter((f) => !f.submittedAt);
      if (filingRows.length === 0 || unsubmitted.length > 0) {
        throw new BadRequestException(`Incident ${incidentNo} requires regulator reporting but its filing(s) have not yet been submitted — it cannot be closed (${filingRows.length === 0 ? 'no filing opened' : unsubmitted.map((f) => f.filingNo).join(', ')})`);
      }
      reported = true;
    }

    // 战役甲波一 Task 8：三元退役——结案链按类型分流不再手写两支判断，改查注册表的
    // closeActionType（十类终盘每一类都在 INCIDENT_TYPE_REGISTRY 里显式点名归属链）。
    const actionType = typeConfig.closeActionType;
    const impact = this.describeCloseImpact(row, remediationReferenceNos);

    const approval = await this.approvals.createAndSubmit(
      {
        actionType,
        entityRef: row.incidentNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染。战役甲波一 T8 修复轮 1
        // （评审 I1 c，Ruling-11）：IMPACT 口径类型定损时落的 impactSummary（人话摘要）与
        // subjectRefs（新类型锚键值，如 affectedSystem/dataCategories，业务值非 UUID）此前
        // 结案快照没带，裁决人看不到——只在有值时带。T11 修（注释失真）：下面两行用的是
        // 条件展开 `...(x ? { key: x } : {})`，不是 `?? undefined`——没值时整个键都不出现在
        // 展开结果里（等价于"有值才带"，但机制是三元展开，不是 nullish 合并）；subjectRefs
        // 落库是 JSON 字符串，这里解回结构化对象供审批页原样渲染，不是再包一层字符串。
        objectSnapshot: {
          incidentNo: row.incidentNo, customerNo: row.customerNo ?? null,
          type: row.type,
          amount: row.assessedAmount != null ? row.assessedAmount.toString() : null,
          assessmentBasis: row.assessmentBasis ?? null,
          remediationReferenceNos,
          reported,
          impact,
          ...(row.impactSummary ? { impactSummary: row.impactSummary } : {}),
          ...(row.subjectRefs ? { subjectRefs: JSON.parse(row.subjectRefs) } : {}),
        },
      },
      { reason: `Close requested for incident ${row.incidentNo}`, traceId: row.traceId },
      actor,
    );

    await this.incidents.markCloseRequested(row.incidentNo, approval.approvalNo);
    await this.closeAudit(row, {
      action: AuditActions.INCIDENT_CLOSE_REQUESTED, approvalNo: approval.approvalNo, actor,
      reason: `Close requested (${actionType})`,
    });
    return { incidentNo: row.incidentNo, approvalNo: approval.approvalNo as string };
  }

  /**
   * 审批裁决落地。非 APPROVED（DECLINED/CANCELLED/EXPIRED）一律留在原状态、不动 incidents
   * 表——ApprovalsService 自己的 APPROVAL_DECLINED/APPROVAL_EXPIRED/APPROVAL_CANCELLED
   * 审计已经记了这次裁决本身，加上申请时已落的 INCIDENT_CLOSE_REQUESTED（带 approvalNo），
   * 两条对上就能查全链路——事故域的九码审计名册是 spec §7 业主拍板的固定集合（甲波二 T6：
   * 原十一码收窄两码，REGULATOR_REPORT_DRAFTED/REGULATOR_REPORTED 随 saveReportDraft/
   * markReported 一并退役）：REGISTERED/INVESTIGATION_STARTED/NOTE_ADDED/ESCALATED/
   * ASSESSED/REMEDIATION_LINKED/CLOSE_REQUESTED/CLOSED/WITHDRAWN，
   * 见 audit-actions.constant.ts 头注释），没有第十码留给"结案被拒"，故不在这里
   * 另造审计码——与 admin-suspension-workflow.service.ts 的 handleApprovalDecided
   * （只处理 APPROVED，非 APPROVED 直接 no-op）同一先例。
   */
  @OnEvent('workflow.incident.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') return;

    const row = await this.incidents.findByNo(event.entityRef);
    const updated = await this.incidents.close(row.incidentNo);
    // 战役甲波一 T8 修复轮 1（评审 M4，T11 订正）：四条结案链裁决人不再只有 CFO（TECHSEC→CISO，
    // PRUDENTIAL→SENIOR_MANAGEMENT_OFFICER），硬编码兜底会在事件没带 decisionByRole 时把
    // 审计文案写错。改从该类型实际的结案链配置取**末步**第一个角色——触发本 onDecided（案子
    // 转 APPROVED）的永远是最后一步的裁决人，SECURITY 链是两步（MLRO→CFO，见 e2e 用例⑥）：
    // 取首步会把末票 CFO 的裁决错记成 MLRO。查不到（理论上不会发生，每类都在
    // DEFAULT_APPROVAL_POLICIES 里注册）才落回 'CFO'，纯防御，不代表业务默认值。
    const actionType = getIncidentTypeConfig(row.type).closeActionType;
    const steps = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType]?.steps;
    const defaultDeciderRole = (steps?.length ? steps[steps.length - 1]?.roles?.[0] : undefined) ?? 'CFO';
    await this.closeAudit(row, {
      action: AuditActions.INCIDENT_CLOSED, approvalNo: event.approvalNo, causationId: event.approvalId,
      fromStatus: row.status, toStatus: updated.status,
      reason: `Close approved by ${event.decisionByRole ?? defaultDeciderRole}`,
    });
  }

  /**
   * 结案 impact 人话串（走查发现 Fix 1）：类型 + 定损口径/金额 + 善后单张数 + 通报状态，
   * 例「结案事故 INC1（未授权转出）：定损认损 400 USDT-TRON，善后单 2 张，已通报 VARA」；
   * NO_LOSS 口径不带金额：「结案事故 INC1（人工登记）：定损无损失，无善后，无需通报」。
   * （linkRemediation 只挂关联不验落账状态，故 impact 不替审批人担保"已落账"——见终审 Fix 2。）
   */
  private describeCloseImpact(row: any, remediationReferenceNos: string[]): string {
    const typeLabel = INCIDENT_TYPE_IMPACT_LABEL[row.type] ?? row.type;
    const basisVerb = ASSESSMENT_BASIS_IMPACT_VERB[row.assessmentBasis] ?? row.assessmentBasis ?? '-';
    const assessedAmount = row.assessedAmount != null ? row.assessedAmount.toString() : null;
    const assessmentPart = row.assessmentBasis === 'NO_LOSS' || assessedAmount == null
      ? `Assessment: ${basisVerb}`
      : `Assessment: ${basisVerb} ${assessedAmount}${row.assetCode ? ` ${row.assetCode}` : ''}`;
    const remediationPart = remediationReferenceNos.length > 0
      ? `${remediationReferenceNos.length} remediation item(s)`
      : 'no remediation';
    const reportPart = row.reportRequired ? 'reported to VARA' : 'no reporting required';
    return `Closing incident ${row.incidentNo} (${typeLabel}): ${assessmentPart}, ${remediationPart}, ${reportPart}`;
  }

  // ── 审计（本文件专记 CLOSE_REQUESTED/CLOSED 两码——跨主体动作，IncidentService 自己的
  //     recordAudit 不覆盖这两码，见该文件头注释）───────────────────────────────

  private async closeAudit(row: any, patch: {
    action: string; reason?: string; approvalNo?: string; causationId?: string;
    fromStatus?: string; toStatus?: string; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INCIDENT, subjectNo: row.incidentNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (row.customerNo) subjects.push({ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER });
    if (row.sourceCaseNo) subjects.push({ subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED });
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });

    const input: any = {
      action: patch.action, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.INCIDENT,
      primarySubjectType: AuditEntityTypes.INCIDENT, primarySubjectNo: row.incidentNo,
      ownerCustomerNo: row.customerNo ?? undefined, subjects,
      reason: patch.reason, fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      // 两码都是 correlationMode=I，继承 REGISTERED 时铸的 traceId（INCIDENT_AUDIT_ACTIONS 注释）。
      correlationId: row.traceId,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      requestId: `${patch.action}_${row.incidentNo}_${randomUUID()}`,
      metadata: { incidentNo: row.incidentNo, type: row.type },
      sourcePlatform: patch.actor ? 'ADMIN' : 'SYSTEM',
    };
    if (patch.actor) {
      const display = patch.actor.userNo ?? patch.actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: patch.actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}
