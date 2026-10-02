// 战役丙波三 T3：协议发布审批 handler，模板逐字照抄
// ri-replacement-approval.service.ts 的类形状。合规官提、高管单步批（DEFAULT_APPROVAL_POLICIES
// 已注册 AGREEMENT_PUBLISH），裁决后统一派生 `workflow.customer-agreement.decided`
// （ApprovalHandlerBase.buildSecondaryEventName，事件名先登记 domain-events.constants.ts），
// 由 AgreementPublishWorkflowService 一处接。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AgreementPublishApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.AGREEMENT_PUBLISH;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_AGREEMENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
