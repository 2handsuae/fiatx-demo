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
//
// 评审修复（Important 1，修复轮1）：findByNo 之后、registerFromComplaint 之前先预拦
// 同 T2 markEscalated 内部守卫一致的条件（两调查态 + 未升级过）——不满足直接 400、不建
// 事故单。原实现没有这道预拦时，二次升级 / RESOLVED 后升级虽然最终仍会在 markEscalated
// 那一步 400，但事故单已经建好、审计已经写了：门拒了、门后副作用已发生，留一个在事件
// 列表可见、可结案，但投诉侧不回指的孤儿事故（照 T4 承接项B 给 propose() 加的同款预拦
// 先例——白开一张单不如提前拦）。T2 的 markEscalated 守卫原样保留、不删，仍是权威判定，
// 本预拦只是把同一条件提前判一次、避免建单副作用，不取代它。
import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { COMPLAINT_INVESTIGATING_STATUSES } from './complaint.constants';
import { ComplaintsService } from './complaints.service';
import { IncidentService } from '../incidents/incident.service';

@Injectable()
export class ComplaintEscalationWorkflowService {
  constructor(
    private readonly complaints: ComplaintsService,
    private readonly incidents: IncidentService,
  ) {}

  /**
   * 升级：读投诉自己的字段 → 预拦（两调查态 + 未升级过，不满足 400 不建单）→
   * registerFromComplaint 建事故单 → markEscalated 回填引用列（T2 守卫原样保留，仍是
   * 权威判定，见文件头注释）。
   */
  async escalate(actor: ApprovalActorContext, complaintNo: string): Promise<{ incidentNo: string }> {
    const complaint = await this.complaints.findByNo(complaintNo);
    if (!COMPLAINT_INVESTIGATING_STATUSES.includes(complaint.currentStatus) || complaint.escalatedIncidentNo) {
      throw new BadRequestException(
        `Complaint ${complaintNo} must be in an investigating status and not already escalated to raise an incident ` +
        `(current status: ${complaint.currentStatus}` +
        `${complaint.escalatedIncidentNo ? `, already escalated to ${complaint.escalatedIncidentNo}` : ''})`,
      );
    }
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
