// 战役甲波五 T4 · 投诉升级 workflow（task-4-brief.md）。
//
// 铁律③各管各的：本 workflow 横向只调两个主体各自的服务方法——
// IncidentService.registerFromComplaint（建 COMPLAINT_ESCALATION 事故单）与
// ComplaintsService.markEscalated（回填投诉侧 escalatedIncidentNo 引用列）。两个落地
// 动作各自的审计都已经在各自服务内部写好（IncidentService.recordAudit /
// ComplaintsService.recordAudit），本 workflow 不重复写审计、不直写任一张表。
//
// 顺序：先建事故单（registerFromComplaint 需要投诉自己的 ownerCustomerNo/subject 作为
// 事故的 customerNo/description，读走 ComplaintsService.findByNo——铁律③「横向读客户
// 主数据放行」），拿到新出的 incidentNo 之后才能调 markEscalated（它的第三参正是这个号，
// 审批/事故号必须先存在才能回填，同 T3 propose 先开单后落状态的先例）。
import { Injectable } from '@nestjs/common';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ComplaintsService } from './complaints.service';
import { IncidentService } from '../incidents/incident.service';

@Injectable()
export class ComplaintEscalationWorkflowService {
  constructor(
    private readonly complaints: ComplaintsService,
    private readonly incidents: IncidentService,
  ) {}

  /**
   * 升级：读投诉自己的字段拼事故登记 DTO → registerFromComplaint 建事故单 →
   * markEscalated 回填引用列（T2 守卫：两调查态 + 未升级过，在 ComplaintsService 内部判，
   * 本方法不重复这条守卫）。
   */
  async escalate(actor: ApprovalActorContext, complaintNo: string): Promise<{ incidentNo: string }> {
    const complaint = await this.complaints.findByNo(complaintNo);
    const { incidentNo } = await this.incidents.registerFromComplaint(actor, {
      complaintNo,
      ownerCustomerNo: complaint.ownerCustomerNo,
      title: `Complaint escalation — ${complaintNo}`,
      description: complaint.subject,
    });
    await this.complaints.markEscalated(actor, complaintNo, incidentNo);
    return { incidentNo };
  }
}
