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
        throw new BadRequestException(`事故 ${incidentNo} 定损结论非「无损失」或已挂善后单，须先进入处置中（RESOLVING）才能申请结案`);
      }
    } else if (row.status !== IncidentStatus.RESOLVING) {
      if (row.status === IncidentStatus.CLOSED) {
        throw new BadRequestException(`事故 ${incidentNo} 已结案，不能再申请结案`);
      }
      if (row.status === IncidentStatus.WITHDRAWN) {
        throw new BadRequestException(`事故 ${incidentNo} 已撤回，不能申请结案`);
      }
      throw new BadRequestException(`事故 ${incidentNo} 当前状态 ${row.status} 不能申请结案——须先完成定损（进入 ASSESSED 或 RESOLVING）`);
    }
    if (row.reportRequired && !row.reportedAt) {
      throw new BadRequestException(`事故 ${incidentNo} 判定需要监管通报但尚未标记已通报，不能结案`);
    }

    const actionType = row.type === IncidentTypes.UNAUTHORIZED_OUTFLOW
      ? ApprovalActionTypes.INCIDENT_CLOSE_SECURITY
      : ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL;

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
        },
      },
      { reason: `事故 ${row.incidentNo} 申请结案`, traceId: row.traceId },
      actor,
    );

    await this.incidents.markCloseRequested(row.incidentNo, approval.approvalNo);
    await this.closeAudit(row, {
      action: AuditActions.INCIDENT_CLOSE_REQUESTED, approvalNo: approval.approvalNo, actor,
      reason: `申请结案（${actionType}）`,
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
      reason: `${event.decisionByRole ?? 'CFO'} 批准结案`,
    });
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
