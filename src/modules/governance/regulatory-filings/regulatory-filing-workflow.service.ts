// 战役甲波二 · 报送台骨架（Task 4）：签发编排点。
// 铁律③：审批是另一个主体（ApprovalsService），跨主体协作只发生在 workflow——
// submitForSignoff 的守卫、objectSnapshot 组装、onDecided 的裁决转发都放这里；对
// regulatory_filings 表的实际读写全部经 RegulatoryFilingService 的三个纯方法
// （findByNo/markSignoffRequested/applySignoffDecision），本文件不直碰该表。审计
// （FILING_SIGNOFF_REQUESTED/FILING_SIGNED_OFF/FILING_SIGNOFF_REJECTED）已在 service
// 侧的这两个方法内部记过，本文件不再另记一份（区别于 incident-close-workflow.ts 的
// closeAudit 先例——那是因为 incidents 域两码没有归入 IncidentService 自己的
// recordAudit）。
//
// 模板：守卫/objectSnapshot 形状照抄 incident-close-workflow.service.ts 的
// requestClose；onDecided 区别于事故先例——事故结案只吃 APPROVED（非 APPROVED 留在原
// 状态不动），报送签发被驳回要回草拟（spec §3：DRAFT→PENDING_SIGNOFF→SIGNED_OFF/DRAFT
// 六边表），故四种 decision 全部转发给 applySignoffDecision，由 service 侧的迁移守卫
// 决定落地状态，workflow 层不挑拣。
import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RegulatoryFiling } from '@prisma/client';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../approvals/constants/approval.constants';
import { FilingStatus, REGULATORY_AUTHORITY_LABELS } from './regulatory-filing.constants';
import { getFilingTypeConfig } from './filing-type-registry';
import { RegulatoryFilingService } from './regulatory-filing.service';

@Injectable()
export class RegulatoryFilingWorkflowService {
  constructor(
    private readonly filings: RegulatoryFilingService,
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * 申请签发（真正入口，HTTP 层调这个，不直接调 RegulatoryFilingService）。
   * 前置：status===DRAFT；body 非空/非纯空白。
   */
  async submitForSignoff(filingNo: string, actor: ApprovalActorContext): Promise<{ filingNo: string; approvalNo: string }> {
    const row = await this.filings.findByNo(filingNo);
    if (row.status !== FilingStatus.DRAFT) {
      throw new BadRequestException(`Filing ${filingNo} is in status ${row.status} — signoff can only be requested from Draft`);
    }
    if (!row.body || !row.body.trim()) {
      throw new BadRequestException(`Filing ${filingNo} has no body — signoff cannot be requested for an empty filing`);
    }

    const impact = this.describeSignoffImpact(row);
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.REG_FILING_SUBMIT,
        entityRef: row.filingNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染。
        objectSnapshot: {
          filingNo: row.filingNo, type: row.type, direction: row.direction, authority: row.authority,
          ccAuthorities: row.ccAuthorities ? row.ccAuthorities.split(',') : [],
          basisCode: row.basisCode ?? null, incidentNo: row.incidentNo ?? null,
          deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
          title: row.title, impact,
        },
      },
      { reason: `Signoff requested for filing ${row.filingNo}`, traceId: row.traceId },
      actor,
    );

    await this.filings.markSignoffRequested(row.filingNo, approval.approvalNo as string, actor);
    return { filingNo: row.filingNo, approvalNo: approval.approvalNo as string };
  }

  /**
   * 审批裁决落地——四种 decision 全部转发给 applySignoffDecision（区别于事故 close
   * 先例，见文件头注释）。审计已在 service 侧记，本文件不重复记。
   */
  @OnEvent('workflow.regulatory-filing.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    await this.filings.applySignoffDecision(event.entityRef, event.decision, {
      approvalNo: event.approvalNo, approvalId: event.approvalId, decisionReason: event.decisionReason,
    });
  }

  /** 签发 impact 人话串：类型 + 机构 + （事故通报单才有的）关联事故 + （已落定钟才有的）
   * 法定期限。「有值才带」——没有 incidentNo/deadlineAt 时对应半句整段不出现。 */
  private describeSignoffImpact(row: RegulatoryFiling): string {
    const typeLabel = getFilingTypeConfig(row.type).label;
    const authorityLabel = REGULATORY_AUTHORITY_LABELS[row.authority] ?? row.authority;
    const incidentPart = row.incidentNo ? ` for incident ${row.incidentNo}` : '';
    const deadlinePart = row.deadlineAt ? `, statutory deadline ${row.deadlineAt.toISOString()}` : '';
    return `Submitting ${typeLabel} to ${authorityLabel}${incidentPart}${deadlinePart}`;
  }
}
