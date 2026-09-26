// 战役甲波四 T5：RI 换人审批 handler，模板逐字照抄
// sanction-disposition-approval.service.ts 的类形状。合规官提、高管单步批（spec §4.2，
// DEFAULT_APPROVAL_POLICIES 已注册），裁决后统一派生
// `workflow.responsible-individual.decided`（ApprovalHandlerBase.buildSecondaryEventName，
// 事件名先登记 domain-events.constants.ts），由 RiReplacementWorkflowService 一处接。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class RiReplacementApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.RI_REPLACEMENT;
  readonly workflowType = AuditBusinessWorkflowTypes.RESPONSIBLE_INDIVIDUAL;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
