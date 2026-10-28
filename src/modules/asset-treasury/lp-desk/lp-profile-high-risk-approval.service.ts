// 甲波六 T4 · LP 高风险准入审批链（CFO → 高管两步），派生 `workflow.lp-profile.decided` 事件，
// LpProfileWorkflowService 用 @OnEvent 接住（照 lp-profile-approval.service.ts 同款 17 行模板）。
// workflowType 与低 / 中风险的 LpProfileApprovalService 相同（LP_PROFILE），故事件名相同——两个 handler 各自只认
// 自己 actionType 的单，由 workflow 按 payload.actionType 分流（目前两种批准 / 驳回 / 撤单 / 超时的落地一致）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** LP 高风险准入审批：PENDING_APPROVAL → ACTIVE / REJECTED / PENDING_ASSESSMENT（撤单）。 */
@Injectable()
export class LpProfileHighRiskApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.LP_PROFILE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
