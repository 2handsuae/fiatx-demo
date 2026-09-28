// 战役甲波五 T4（承接项A，前序评审裁定并入本任务）：投诉裁决审批 handler，模板逐字照抄
// ri-replacement-approval.service.ts 的类形状。合规官单步批（T3 DEFAULT_APPROVAL_POLICIES
// 已注册 COMPLAINT_RESOLUTION），裁决后统一派生 `workflow.complaint.decided`
// （ApprovalHandlerBase.buildSecondaryEventName，事件名已在 domain-events.constants.ts
// 登记为 COMPLAINT_RESOLUTION_DECIDED，emitter 字段早就点名本类），由
// ComplaintResolutionWorkflowService.onDecided（T3 交付）一处接。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class ComplaintResolutionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.COMPLAINT_RESOLUTION;
  readonly workflowType = AuditBusinessWorkflowTypes.COMPLAINT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
