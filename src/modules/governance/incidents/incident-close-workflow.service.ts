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
import { ApprovalActionTypes, ApprovalActorContext } from '../approvals/constants/approval.constants';
import { IncidentStatus, IncidentTypes } from './incident.constants';
import { IncidentService } from './incident.service';

// 走查发现 Fix 1：结案审批页是 MLRO/CFO 的最后一道人闸，其余审批类型（模板见
// internal-transfer-workflow.service.ts 的 impact 串）都给裁决人一句人话后果描述，
// 事故结案此前没有——裁决人只看得到裸字段，读不出"批下去会怎样"。这两张表只用来
// 把类型 / 定损口径译成人话，镜像 admin-web/src/utils/incidentStatusMap.ts 的
// INCIDENT_TYPE_LABEL / ASSESSMENT_BASIS_LABEL（前后端各自维护展示词，无共享路径）。
const INCIDENT_TYPE_IMPACT_LABEL: Record<string, string> = {
  [IncidentTypes.UNAUTHORIZED_OUTFLOW]: 'Unauthorized outflow',
  [IncidentTypes.LARGE_UNEXPLAINED]: 'Large unexplained',
  [IncidentTypes.CLIENT_SHORTFALL]: 'Client shortfall',
  [IncidentTypes.MANUAL]: 'Manual registration',
};
const ASSESSMENT_BASIS_IMPACT_VERB: Record<string, string> = {
  RECOVERED: 'recovered', FIRM_LOSS: 'loss recognized', CLIENT_COLLECTION: 'pursuing collection', NO_LOSS: 'no loss',
};

@Injectable()
export class IncidentCloseWorkflowService {
  constructor(
    private readonly incidents: IncidentService,
    private readonly approvals: ApprovalsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * 申请结案（真正入口，HTTP 层调这个，不直接调 IncidentService）。
   * 前置：状态 ∈ {ASSESSED（仅定损口径 NO_LOSS 且零善后挂载——无善后径）, RESOLVING}；
   * REGISTERED/INVESTIGATING（还没定损）→ 400（变异靶子①：这条守卫必须单独测）。
   * reportRequired=true 而未 markReported → 400（通报没留痕不许关）。
   */
  async requestClose(incidentNo: string, actor: ApprovalActorContext): Promise<{ incidentNo: string; approvalNo: string }> {
    const row = await this.incidents.findByNo(incidentNo);
    const remediationReferenceNos = await this.incidents.findRemediations(incidentNo);

    if (row.status === IncidentStatus.ASSESSED) {
      if (row.assessmentBasis !== 'NO_LOSS' || remediationReferenceNos.length > 0) {
        throw new BadRequestException(`Incident ${incidentNo} assessment conclusion is not "no loss" or already has remediation linked — it must enter Resolving before close can be requested`);
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
    if (row.reportRequired && !row.reportedAt) {
      throw new BadRequestException(`Incident ${incidentNo} is determined to require regulator reporting but has not been marked as reported — it cannot be closed`);
    }

    const actionType = row.type === IncidentTypes.UNAUTHORIZED_OUTFLOW
      ? ApprovalActionTypes.INCIDENT_CLOSE_SECURITY
      : ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL;
    const impact = this.describeCloseImpact(row, remediationReferenceNos);

    const approval = await this.approvals.createAndSubmit(
      {
        actionType,
        entityRef: row.incidentNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          incidentNo: row.incidentNo, customerNo: row.customerNo ?? null,
          type: row.type,
          amount: row.assessedAmount != null ? row.assessedAmount.toString() : null,
          assessmentBasis: row.assessmentBasis ?? null,
          remediationReferenceNos,
          reported: !!row.reportedAt,
          impact,
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
   * 两条对上就能查全链路——事故域的十一码审计名册是 spec §7 业主拍板的固定集合
   * （REGISTERED/INVESTIGATION_STARTED/NOTE_ADDED/ESCALATED/ASSESSED/REMEDIATION_LINKED/
   * REGULATOR_REPORT_DRAFTED/REGULATOR_REPORTED/CLOSE_REQUESTED/CLOSED/WITHDRAWN，
   * 见 audit-actions.constant.ts 头注释），没有第十二码留给"结案被拒"，故不在这里
   * 另造审计码——与 admin-suspension-workflow.service.ts 的 handleApprovalDecided
   * （只处理 APPROVED，非 APPROVED 直接 no-op）同一先例。
   */
  @OnEvent('workflow.incident.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') return;

    const row = await this.incidents.findByNo(event.entityRef);
    const updated = await this.incidents.close(row.incidentNo);
    await this.closeAudit(row, {
      action: AuditActions.INCIDENT_CLOSED, approvalNo: event.approvalNo, causationId: event.approvalId,
      fromStatus: row.status, toStatus: updated.status,
      reason: `Close approved by ${event.decisionByRole ?? 'CFO'}`,
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
